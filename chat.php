<?php
declare(strict_types=1);
require_once __DIR__ . '/db.php';
ensure_schema();
start_session();
require_once __DIR__ . '/Pusher/Pusher.php';

$pusher = null;
if (realtime_enabled()) {
  try {
    $pusher = new Pusher\Pusher(
      PUSHER_KEY,
      PUSHER_SECRET,
      PUSHER_APP_ID,
      ['cluster' => PUSHER_CLUSTER, 'useTLS' => true]
    );
  } catch (Throwable $e) {
    $pusher = null;
  }
}

// ---------- API (AJAX) ----------
function api_auth_user(): array {
  $uid = current_user_id();
  if (!$uid) json_out(['ok' => false, 'error' => 'Yetkisiz.'], 401);
  $u = get_user($uid);
  if (!$u) json_out(['ok' => false, 'error' => 'Kullanıcı yok.'], 401);
  if (is_banned($u)) json_out(['ok' => false, 'error' => 'Hesap banlı.'], 403);
  return $u;
}

function room_slug(string $s): string {
  $s = strtolower(trim($s));
  return in_array($s, ['genel', 'evlilik', 'dini'], true) ? $s : 'genel';
}

function clean_message(string $s): string {
  $s = trim($s);
  $s = preg_replace("/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/u", "", $s) ?? '';
  if (mb_strlen($s) > 1000) $s = mb_substr($s, 0, 1000);
  return $s;
}

if (isset($_GET['action'])) {
  rate_limit('api');
  $db = pdo();
  $action = (string)$_GET['action'];

  if ($action === 'logout') {
    session_destroy();
    json_out(['ok' => true]);
  }

  if ($action === 'make_admin') {
    // one-time helper: /chat.php?action=make_admin&key=...&username=...
    $key = (string)($_GET['key'] ?? '');
    $username = strtolower(trim((string)($_GET['username'] ?? '')));
    if ($key !== ADMIN_KEY) json_out(['ok' => false, 'error' => 'Yasak.'], 403);
    if ($username === '') json_out(['ok' => false, 'error' => 'username gerekli.'], 400);
    $stmt = $db->prepare("UPDATE users SET role='admin' WHERE username=?");
    $stmt->execute([$username]);
    json_out(['ok' => true, 'changed' => $stmt->rowCount()]);
  }

  $me = api_auth_user();

  if ($action === 'me') {
    json_out(['ok' => true, 'user' => [
      'id' => (int)$me['id'],
      'first_name' => $me['first_name'],
      'last_name' => $me['last_name'],
      'username' => $me['username'],
      'email' => $me['email'],
      'phone' => $me['phone'],
      'city' => $me['city'],
      'about' => $me['about'],
      'role' => $me['role'],
    ]]);
  }

  if ($action === 'profile_update' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    rate_limit('profile_update');
    $first = trim((string)($_POST['first_name'] ?? ''));
    $last = trim((string)($_POST['last_name'] ?? ''));
    $email = strtolower(trim((string)($_POST['email'] ?? '')));
    $phone = trim((string)($_POST['phone'] ?? ''));
    $city = trim((string)($_POST['city'] ?? ''));
    $about = trim((string)($_POST['about'] ?? ''));

    if ($first === '' || $last === '' || $email === '' || $phone === '' || $city === '') {
      json_out(['ok' => false, 'error' => 'Eksik alan var.'], 400);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_out(['ok' => false, 'error' => 'Email geçersiz.'], 400);

    $stmt = $db->prepare("UPDATE users SET first_name=?, last_name=?, email=?, phone=?, city=?, about=? WHERE id=?");
    $stmt->execute([$first, $last, $email, $phone, $city, mb_substr($about, 0, 280), (int)$me['id']]);
    $me = get_user((int)$me['id']);
    json_out(['ok' => true, 'user' => $me]);
  }

  if ($action === 'users') {
    $q = trim((string)($_GET['q'] ?? ''));
    $stmt = $db->prepare("SELECT
      u.id, u.first_name, u.last_name, u.username, u.city, u.about, u.role, u.banned_until,
      EXISTS(SELECT 1 FROM blocks b1 WHERE b1.user_id=? AND b1.blocked_user_id=u.id) AS blocked_by_me,
      EXISTS(SELECT 1 FROM blocks b2 WHERE b2.user_id=u.id AND b2.blocked_user_id=?) AS blocked_me
      FROM users u
      WHERE u.id<>? AND (u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)
      ORDER BY u.username
      LIMIT 40");
    $like = '%' . $q . '%';
    $stmt->execute([(int)$me['id'], (int)$me['id'], (int)$me['id'], $like, $like, $like]);
    $rows = $stmt->fetchAll();
    $users = array_map(static function ($u) {
      return [
        'id' => (int)$u['id'],
        'first_name' => $u['first_name'],
        'last_name' => $u['last_name'],
        'username' => $u['username'],
        'city' => $u['city'],
        'about' => $u['about'],
        'is_admin' => ($u['role'] ?? '') === 'admin',
        'is_banned' => $u['banned_until'] && strtotime($u['banned_until']) > time(),
        'blocked_by_me' => (int)$u['blocked_by_me'] === 1,
        'blocked_me' => (int)$u['blocked_me'] === 1,
      ];
    }, $rows);
    json_out(['ok' => true, 'users' => $users]);
  }

  if ($action === 'block' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    rate_limit('block');
    $targetId = (int)($_POST['user_id'] ?? 0);
    if ($targetId <= 0 || $targetId === (int)$me['id']) json_out(['ok' => false, 'error' => 'Geçersiz.'], 400);
    $check = $db->prepare("SELECT id FROM users WHERE id=? LIMIT 1");
    $check->execute([$targetId]);
    if (!$check->fetch()) json_out(['ok' => false, 'error' => 'Kullanıcı bulunamadı.'], 404);
    $stmt = $db->prepare("INSERT IGNORE INTO blocks (user_id, blocked_user_id) VALUES (?, ?)");
    $stmt->execute([(int)$me['id'], $targetId]);
    json_out(['ok' => true]);
  }

  if ($action === 'unblock' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    rate_limit('block');
    $targetId = (int)($_POST['user_id'] ?? 0);
    if ($targetId <= 0 || $targetId === (int)$me['id']) json_out(['ok' => false, 'error' => 'Geçersiz.'], 400);
    $stmt = $db->prepare("DELETE FROM blocks WHERE user_id=? AND blocked_user_id=?");
    $stmt->execute([(int)$me['id'], $targetId]);
    json_out(['ok' => true]);
  }

  if ($action === 'blocks') {
    $stmt = $db->prepare("
      SELECT u.id, u.first_name, u.last_name, u.username, u.city, u.about, b.created_at
      FROM blocks b
      JOIN users u ON u.id = b.blocked_user_id
      WHERE b.user_id=?
      ORDER BY b.created_at DESC
      LIMIT 150
    ");
    $stmt->execute([(int)$me['id']]);
    $rows = $stmt->fetchAll();
    $users = array_map(static function ($u) {
      return [
        'id' => (int)$u['id'],
        'first_name' => $u['first_name'],
        'last_name' => $u['last_name'],
        'username' => $u['username'],
        'city' => $u['city'],
        'about' => $u['about'],
      ];
    }, $rows);
    json_out(['ok' => true, 'users' => $users]);
  }

  if ($action === 'dm_threads') {
    $stmt = $db->prepare("
      SELECT
        t.other_id,
        u.username, u.first_name, u.last_name,
        t.last_id, x2.message AS last_message, x2.created_at AS last_created_at,
        EXISTS(SELECT 1 FROM blocks b1 WHERE b1.user_id=? AND b1.blocked_user_id=t.other_id) AS blocked_by_me,
        EXISTS(SELECT 1 FROM blocks b2 WHERE b2.user_id=t.other_id AND b2.blocked_user_id=?) AS blocked_me
      FROM (
        SELECT
          IF(from_user_id=?, to_user_id, from_user_id) AS other_id,
          MAX(id) AS last_id
        FROM dm_messages
        WHERE from_user_id=? OR to_user_id=?
        GROUP BY IF(from_user_id=?, to_user_id, from_user_id)
      ) t
      JOIN dm_messages x2 ON x2.id = t.last_id
      JOIN users u ON u.id = t.other_id
      ORDER BY t.last_id DESC
      LIMIT 100
    ");
    $meId = (int)$me['id'];
    $stmt->execute([$meId, $meId, $meId, $meId, $meId, $meId]);
    $rows = $stmt->fetchAll();
    $threads = array_map(static function ($r) {
      return [
        'other_id' => (int)$r['other_id'],
        'username' => $r['username'],
        'first_name' => $r['first_name'],
        'last_name' => $r['last_name'],
        'last_id' => (int)$r['last_id'],
        'last_message' => (string)$r['last_message'],
        'last_time' => date('H:i', strtotime((string)$r['last_created_at'])),
        'blocked_by_me' => (int)$r['blocked_by_me'] === 1,
        'blocked_me' => (int)$r['blocked_me'] === 1,
      ];
    }, $rows);
    json_out(['ok' => true, 'threads' => $threads]);
  }

  if ($action === 'report' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    rate_limit('report');
    $targetId = (int)($_POST['user_id'] ?? 0);
    $reason = trim((string)($_POST['reason'] ?? ''));
    if ($targetId <= 0 || $reason === '') json_out(['ok' => false, 'error' => 'Eksik.'], 400);
    $stmt = $db->prepare("INSERT INTO reports (reporter_id, target_user_id, reason) VALUES (?,?,?)");
    $stmt->execute([(int)$me['id'], $targetId, mb_substr($reason, 0, 500)]);
    json_out(['ok' => true]);
  }

  if ($action === 'send' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    rate_limit('send');
    $room = room_slug((string)($_POST['room'] ?? 'genel'));
    $msg = clean_message((string)($_POST['message'] ?? ''));
    if ($msg === '') json_out(['ok' => false, 'error' => 'Boş mesaj.'], 400);

    $stmt = $db->prepare("INSERT INTO room_messages (room_slug, user_id, message) VALUES (?,?,?)");
    $stmt->execute([$room, (int)$me['id'], $msg]);
    $newId = (int)$db->lastInsertId();
    if ($pusher) {
      try {
        $pusher->trigger('room-' . $room, 'new-message', [
          'id' => $newId,
          'username' => (string)$me['username'],
          'user_id' => (int)$me['id'],
          'message' => $msg,
          'time' => date('H:i'),
          'deleted' => false,
        ]);
      } catch (Throwable $e) {
        // polling fallback aktif kalır
      }
    }
    json_out(['ok' => true]);
  }

  if ($action === 'fetch') {
    $room = room_slug((string)($_GET['room'] ?? 'genel'));
    $afterId = (int)($_GET['after_id'] ?? 0);

    $stmt = $db->prepare("
      SELECT m.id, m.message, m.created_at, m.deleted, u.username, u.id AS user_id
      FROM room_messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.room_slug=? AND m.id > ?
      ORDER BY m.id ASC
      LIMIT 50
    ");
    $stmt->execute([$room, $afterId]);
    $rows = $stmt->fetchAll();
    $messages = array_map(static function ($r) {
      return [
        'id' => (int)$r['id'],
        'username' => $r['username'],
        'user_id' => (int)$r['user_id'],
        'time' => date('H:i', strtotime((string)$r['created_at'])),
        'message' => (int)$r['deleted'] === 1 ? '— silindi —' : (string)$r['message'],
        'deleted' => (int)$r['deleted'] === 1,
      ];
    }, $rows);
    json_out(['ok' => true, 'messages' => $messages]);
  }

  if ($action === 'dm_send' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    rate_limit('dm_send');
    $toId = (int)($_POST['to_user_id'] ?? 0);
    $msg = clean_message((string)($_POST['message'] ?? ''));
    if ($toId <= 0 || $toId === (int)$me['id']) json_out(['ok' => false, 'error' => 'Geçersiz kullanıcı.'], 400);
    if ($msg === '') json_out(['ok' => false, 'error' => 'Boş mesaj.'], 400);
    if (!can_talk((int)$me['id'], $toId)) json_out(['ok' => false, 'error' => 'Bu kullanıcıyla iletişim kurulamaz.'], 403);

    $stmt = $db->prepare("INSERT INTO dm_messages (from_user_id, to_user_id, message) VALUES (?,?,?)");
    $stmt->execute([(int)$me['id'], $toId, $msg]);
    $newId = (int)$db->lastInsertId();
    if ($pusher) {
      $dmPayload = [
        'id' => $newId,
        'from_user_id' => (int)$me['id'],
        'to_user_id' => $toId,
        'username' => (string)$me['username'],
        'message' => $msg,
        'time' => date('H:i'),
        'deleted' => false,
      ];
      try {
        $pusher->trigger('dm-' . $toId, 'new-dm', $dmPayload);
      } catch (Throwable $e) {
        // polling fallback aktif kalır
      }
    }
    json_out(['ok' => true]);
  }

  if ($action === 'dm_fetch') {
    $withId = (int)($_GET['with_user_id'] ?? 0);
    $afterId = (int)($_GET['after_id'] ?? 0);
    if ($withId <= 0 || $withId === (int)$me['id']) json_out(['ok' => false, 'error' => 'Geçersiz kullanıcı.'], 400);

    $stmt = $db->prepare("
      SELECT d.id, d.message, d.created_at, d.deleted, u.username, d.from_user_id
      FROM dm_messages d
      JOIN users u ON u.id = d.from_user_id
      WHERE d.id > ?
        AND ((d.from_user_id=? AND d.to_user_id=?) OR (d.from_user_id=? AND d.to_user_id=?))
      ORDER BY d.id ASC
      LIMIT 50
    ");
    $stmt->execute([$afterId, (int)$me['id'], $withId, $withId, (int)$me['id']]);
    $rows = $stmt->fetchAll();
    $messages = array_map(static function ($r) {
      return [
        'id' => (int)$r['id'],
        'username' => $r['username'],
        'time' => date('H:i', strtotime((string)$r['created_at'])),
        'message' => (int)$r['deleted'] === 1 ? '— silindi —' : (string)$r['message'],
        'deleted' => (int)$r['deleted'] === 1,
        'from_me' => false, // client will set
        'from_user_id' => (int)$r['from_user_id'],
      ];
    }, $rows);
    $response = [
      'ok' => true,
      'messages' => $messages,
      'me_id' => (int)$me['id'],
    ];
    if ($afterId === 0) {
      // only evaluate block state on initial DM load to reduce per-poll queries
      $response['can_message'] = can_talk((int)$me['id'], $withId);
    }
    json_out($response);
  }

  if ($action === 'poll') {
    $mode = (string)($_GET['mode'] ?? 'room');

    if ($mode === 'dm') {
      $withId = (int)($_GET['with_user_id'] ?? 0);
      $afterId = (int)($_GET['after_id'] ?? 0);
      if ($withId <= 0 || $withId === (int)$me['id']) json_out(['ok' => false, 'error' => 'Geçersiz kullanıcı.'], 400);

      $stmt = $db->prepare("
        SELECT d.id, d.message, d.created_at, d.deleted, u.username, d.from_user_id
        FROM dm_messages d
        JOIN users u ON u.id = d.from_user_id
        WHERE d.id > ?
          AND ((d.from_user_id=? AND d.to_user_id=?) OR (d.from_user_id=? AND d.to_user_id=?))
        ORDER BY d.id ASC
        LIMIT 50
      ");
      $stmt->execute([$afterId, (int)$me['id'], $withId, $withId, (int)$me['id']]);
      $rows = $stmt->fetchAll();
      $messages = array_map(static function ($r) {
        return [
          'id' => (int)$r['id'],
          'username' => $r['username'],
          'time' => date('H:i', strtotime((string)$r['created_at'])),
          'message' => (int)$r['deleted'] === 1 ? '— silindi —' : (string)$r['message'],
          'deleted' => (int)$r['deleted'] === 1,
          'from_user_id' => (int)$r['from_user_id'],
        ];
      }, $rows);
      $response = ['ok' => true, 'mode' => 'dm', 'messages' => $messages];
      if ($afterId === 0) {
        $response['can_message'] = can_talk((int)$me['id'], $withId);
      }
      json_out($response);
    }

    $room = room_slug((string)($_GET['room'] ?? 'genel'));
    $afterId = (int)($_GET['after_id'] ?? 0);

    $stmt = $db->prepare("
      SELECT m.id, m.message, m.created_at, m.deleted, u.username, u.id AS user_id
      FROM room_messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.room_slug=? AND m.id > ?
      ORDER BY m.id ASC
      LIMIT 50
    ");
    $stmt->execute([$room, $afterId]);
    $rows = $stmt->fetchAll();
    $messages = array_map(static function ($r) {
      return [
        'id' => (int)$r['id'],
        'username' => $r['username'],
        'user_id' => (int)$r['user_id'],
        'time' => date('H:i', strtotime((string)$r['created_at'])),
        'message' => (int)$r['deleted'] === 1 ? '— silindi —' : (string)$r['message'],
        'deleted' => (int)$r['deleted'] === 1,
      ];
    }, $rows);
    json_out(['ok' => true, 'mode' => 'room', 'messages' => $messages]);
  }

  if ($action === 'admin_ban' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!is_admin($me)) json_out(['ok' => false, 'error' => 'Admin gerekli.'], 403);
    rate_limit('admin');
    $targetId = (int)($_POST['user_id'] ?? 0);
    $minutes = max(1, min(60 * 24 * 30, (int)($_POST['minutes'] ?? 60))); // max 30d
    if ($targetId <= 0) json_out(['ok' => false, 'error' => 'Geçersiz.'], 400);
    $until = date('Y-m-d H:i:s', time() + ($minutes * 60));
    $stmt = $db->prepare("UPDATE users SET banned_until=? WHERE id=?");
    $stmt->execute([$until, $targetId]);
    json_out(['ok' => true]);
  }

  if ($action === 'admin_ban_username' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!is_admin($me)) json_out(['ok' => false, 'error' => 'Admin gerekli.'], 403);
    rate_limit('admin');
    $username = strtolower(trim((string)($_POST['username'] ?? '')));
    $minutes = max(1, min(60 * 24 * 30, (int)($_POST['minutes'] ?? 60)));
    if ($username === '') json_out(['ok' => false, 'error' => 'Kullanıcı adı gerekli.'], 400);
    $until = date('Y-m-d H:i:s', time() + ($minutes * 60));
    $stmt = $db->prepare("UPDATE users SET banned_until=? WHERE username=?");
    $stmt->execute([$until, $username]);
    if ($stmt->rowCount() < 1) json_out(['ok' => false, 'error' => 'Kullanıcı bulunamadı.'], 404);
    json_out(['ok' => true]);
  }

  if ($action === 'admin_make_admin' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $key = (string)($_POST['key'] ?? '');
    $username = strtolower(trim((string)($_POST['username'] ?? '')));
    if ($key !== ADMIN_KEY) json_out(['ok' => false, 'error' => 'Anahtar yanlış.'], 403);
    if ($username === '') json_out(['ok' => false, 'error' => 'Kullanıcı adı gerekli.'], 400);
    $stmt = $db->prepare("UPDATE users SET role='admin' WHERE username=?");
    $stmt->execute([$username]);
    if ($stmt->rowCount() < 1) json_out(['ok' => false, 'error' => 'Kullanıcı bulunamadı.'], 404);
    json_out(['ok' => true]);
  }

  if ($action === 'admin_delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!is_admin($me)) json_out(['ok' => false, 'error' => 'Admin gerekli.'], 403);
    rate_limit('admin');
    $type = (string)($_POST['type'] ?? 'room');
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) json_out(['ok' => false, 'error' => 'Geçersiz.'], 400);
    if ($type === 'dm') {
      $stmt = $db->prepare("UPDATE dm_messages SET deleted=1, deleted_by=? WHERE id=?");
      $stmt->execute([(int)$me['id'], $id]);
    } else {
      $stmt = $db->prepare("UPDATE room_messages SET deleted=1, deleted_by=? WHERE id=?");
      $stmt->execute([(int)$me['id'], $id]);
    }
    json_out(['ok' => true]);
  }

  json_out(['ok' => false, 'error' => 'Bilinmeyen action.'], 404);
}

// ---------- PAGE ----------
$uid = require_login();
$me = get_user($uid);
if (!$me) { session_destroy(); header('Location: login.php'); exit; }
if (is_banned($me)) { session_destroy(); header('Location: login.php'); exit; }

$rooms = [
  ['slug' => 'genel', 'title' => 'Genel'],
  ['slug' => 'evlilik', 'title' => 'Evlilik'],
  ['slug' => 'dini', 'title' => 'Dini'],
];

$isAdmin = is_admin($me);
?>
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>AleviChat — Evlilik & Sohbet</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <div class="app-shell" id="appShell">
      <header class="topbar">
        <div class="topbar__left">
          <button class="icon-btn mobile-only" id="btnToggleLeft" aria-label="Menüyü aç/kapat">
            <span class="icon icon--menu"></span>
          </button>
          <div class="brand">
            <div class="brand__mark">A</div>
            <div class="brand__text">
              <div class="brand__title">AleviChat</div>
              <div class="brand__subtitle" id="activeRoomLabel"># Genel</div>
            </div>
          </div>
        </div>

        <div class="topbar__right">
          <div class="pill pill--status" title="Durum">
            <span class="dot dot--ok"></span>
            <span style="color: var(--muted); font-size:13px;">Canlı</span>
          </div>
          <button class="btn btn--ghost" id="btnOpenDM">DM</button>
          <button class="btn btn--ghost" id="btnProfile">Profil</button>
          <button class="btn btn--primary" id="btnLogout">Çıkış</button>
        </div>
      </header>

      <!-- LEFT SIDEBAR -->
      <aside class="sidebar sidebar--left" id="leftSidebar">
        <div class="sidebar__section">
          <div class="sidebar__title">Odalar</div>
          <nav class="room-list" id="roomList">
            <?php foreach ($rooms as $i => $r): ?>
              <button class="room-item <?=$i===0 ? 'is-active' : ''?>" data-room="<?=h($r['slug'])?>">
                <span class="room-item__hash">#</span>
                <span class="room-item__name"><?=h($r['title'])?></span>
              </button>
            <?php endforeach; ?>
          </nav>
        </div>

        <div class="sidebar__section">
          <div class="sidebar__title">Menü</div>
          <div class="menu-list">
            <button class="menu-item" id="btnOpenUsers">
              <span class="icon icon--users"></span>
              Kullanıcılar
            </button>
            <?php if ($isAdmin): ?>
              <button class="menu-item" id="btnAdminHint">
                <span class="icon icon--settings"></span>
                Admin
              </button>
            <?php endif; ?>
          </div>
        </div>

        <div class="sidebar__footer">
          <div class="me-card" id="meCard">
            <div class="avatar avatar--md" id="meAvatar"><?=h(mb_strtoupper(mb_substr($me['first_name'],0,1)) . mb_strtoupper(mb_substr($me['last_name'],0,1)))?></div>
            <div class="me-card__meta">
              <div class="me-card__name" id="meName"><?=h($me['first_name'].' '.$me['last_name'])?></div>
              <div class="me-card__sub" id="meSub">@<?=h($me['username'])?> · <?=h($me['city'])?><?=$isAdmin ? ' · ADMIN' : ''?></div>
            </div>
          </div>
        </div>
      </aside>

      <!-- MAIN CHAT -->
      <main class="main">
        <section class="chat">
          <div class="chat__header">
            <div class="chat__header-left">
              <div class="chat__room-pill" id="chatRoomPill"># Genel</div>
              <div class="chat__hint">Alevi topluluğu için güvenli ve saygılı iletişim.</div>
            </div>
            <div class="chat__header-right">
              <button class="icon-btn mobile-only" id="btnToggleRight" aria-label="Panel">
                <span class="icon icon--users"></span>
              </button>
            </div>
          </div>

          <div class="chat__body" id="chatBody" aria-live="polite"></div>

          <form class="composer" id="composer">
            <div class="composer__left">
              <button class="icon-btn" type="button" id="btnQuickDM" title="DM">
                <span class="icon icon--at"></span>
              </button>
            </div>
            <div class="composer__mid">
              <input
                id="messageInput"
                class="input input--lg"
                type="text"
                placeholder="Mesaj yaz… (Enter gönder)"
                autocomplete="off"
                maxlength="1000"
              />
              <div class="composer__meta">
                <span class="kbd">Enter</span> Gönder
              </div>
            </div>
            <div class="composer__right">
              <button class="btn btn--primary btn--wide" id="btnSend" type="submit">Gönder</button>
            </div>
          </form>
        </section>
      </main>

      <!-- RIGHT SIDEBAR -->
      <aside class="sidebar sidebar--right" id="rightSidebar">
        <div class="sidebar__section">
          <div class="sidebar__title">DM Konuşmaları</div>
          <div class="card-list" id="dmThreads"></div>
        </div>
        <div class="sidebar__section">
          <div class="sidebar__title">Engellediklerim</div>
          <div class="card-list" id="blockedUsers"></div>
        </div>
      </aside>

      <div class="overlay" id="overlay" hidden></div>
    </div>

    <div class="modal" id="userActionModal" hidden>
      <div class="modal__dialog">
        <div class="modal__header">
          <div>
            <div class="modal__title" id="uaTitle">Kullanıcı İşlemleri</div>
            <div class="modal__sub" id="uaSub">@kullanici</div>
          </div>
          <button class="icon-btn" id="btnCloseUserAction" type="button" aria-label="Kapat">
            <span class="icon icon--close"></span>
          </button>
        </div>
        <div class="modal__body">
          <div class="form" style="gap:10px;">
            <button class="btn btn--primary" type="button" id="btnUserDmStart">DM Başlat</button>
            <button class="btn btn--ghost" type="button" id="btnUserBlock">Engelle</button>
            <button class="btn btn--ghost" type="button" id="btnUserUnblock">Engeli Kaldır</button>
            <button class="btn btn--ghost" type="button" id="btnUserReport">Raporla</button>
            <div class="form__note" id="uaNote"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- PROFILE MODAL -->
    <div class="modal" id="profileModal" hidden>
      <div class="modal__dialog modal__dialog--lg">
        <div class="modal__header">
          <div>
            <div class="modal__title">Profil</div>
            <div class="modal__sub">Bilgilerinizi güncelleyin.</div>
          </div>
          <button class="icon-btn" id="btnCloseProfile" type="button" aria-label="Kapat">
            <span class="icon icon--close"></span>
          </button>
        </div>

        <div class="modal__body">
          <div class="profile-grid">
            <div class="profile-card">
              <div class="profile-card__top">
                <div class="avatar avatar--xl" id="profileAvatar"><?=h(mb_strtoupper(mb_substr($me['first_name'],0,1)) . mb_strtoupper(mb_substr($me['last_name'],0,1)))?></div>
                <div class="profile-card__meta">
                  <div class="profile-card__name" id="profileName"><?=h($me['first_name'].' '.$me['last_name'])?></div>
                  <div class="profile-card__sub" id="profileHandle">@<?=h($me['username'])?></div>
                </div>
              </div>
              <div class="form__note" style="margin-top:10px;">Profil fotoğrafı sonraki sürümde eklenecek.</div>
            </div>

            <div class="panel">
              <div class="panel__title">Profil Düzenle</div>
              <form id="profileForm" class="form">
                <div class="grid grid--2">
                  <div class="field">
                    <label class="label">Ad</label>
                    <input class="input" type="text" id="pfFirstName" required value="<?=h($me['first_name'])?>" />
                  </div>
                  <div class="field">
                    <label class="label">Soyad</label>
                    <input class="input" type="text" id="pfLastName" required value="<?=h($me['last_name'])?>" />
                  </div>
                </div>
                <div class="grid grid--2">
                  <div class="field">
                    <label class="label">Şehir</label>
                    <input class="input" type="text" id="pfCity" required value="<?=h($me['city'])?>" />
                  </div>
                  <div class="field">
                    <label class="label">Telefon</label>
                    <input class="input" type="text" id="pfPhone" required value="<?=h($me['phone'])?>" />
                  </div>
                </div>
                <div class="grid grid--2">
                  <div class="field">
                    <label class="label">Email</label>
                    <input class="input" type="email" id="pfEmail" required value="<?=h($me['email'])?>" />
                  </div>
                  <div class="field">
                    <label class="label">Rol</label>
                    <input class="input" disabled value="<?=$isAdmin ? 'admin' : 'user'?>" />
                  </div>
                </div>
                <div class="field">
                  <label class="label">Hakkında</label>
                  <textarea class="input input--ta" id="pfAbout" rows="4" maxlength="280"><?=h($me['about'])?></textarea>
                </div>
                <div class="row row--end">
                  <button class="btn btn--primary btn--wide" type="submit">Kaydet</button>
                </div>
                <div class="form__note" id="profileNote"></div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- USERS / DM DRAWER -->
    <div class="drawer" id="dmDrawer" hidden>
      <div class="drawer__header">
        <div>
          <div class="drawer__title">Kullanıcılar / DM</div>
          <div class="drawer__sub">Bir kullanıcı seçip DM başlat.</div>
        </div>
        <button class="icon-btn" id="btnCloseDM" aria-label="Kapat">
          <span class="icon icon--close"></span>
        </button>
      </div>
      <div class="drawer__body">
        <div class="panel">
          <div class="panel__title">Ara</div>
          <form class="form form--compact" id="dmSearchForm">
            <div class="field">
              <label class="label">Kullanıcı adı / isim</label>
              <input class="input" id="dmQuery" placeholder="Örn: yusuf" />
            </div>
            <div class="row row--end">
              <button class="btn btn--primary" type="submit">Ara</button>
            </div>
          </form>
        </div>
        <div class="panel">
          <div class="panel__title">Sonuçlar</div>
          <div class="card-list" id="dmResults"></div>
        </div>
      </div>
    </div>

    <!-- ADMIN MODAL -->
    <?php if ($isAdmin): ?>
      <div class="modal" id="adminModal" hidden>
        <div class="modal__dialog">
          <div class="modal__header">
            <div>
              <div class="modal__title">Admin Paneli</div>
              <div class="modal__sub">Ban / admin atama / moderasyon.</div>
            </div>
            <button class="icon-btn" id="btnCloseAdmin" type="button" aria-label="Kapat">
              <span class="icon icon--close"></span>
            </button>
          </div>
          <div class="modal__body">
            <form class="form" id="adminBanForm">
              <div class="panel" style="padding:12px;">
                <div class="panel__title" style="margin-bottom:10px;">Kullanıcı Banla</div>
                <div class="grid grid--2">
                  <div class="field">
                    <label class="label">Kullanıcı adı</label>
                    <input class="input" id="adminBanUsername" placeholder="örn: yusuf" />
                  </div>
                  <div class="field">
                    <label class="label">Dakika</label>
                    <input class="input" id="adminBanMinutes" type="number" min="1" max="43200" value="60" />
                  </div>
                </div>
                <div class="row row--end">
                  <button class="btn btn--primary" type="submit">Ban Uygula</button>
                </div>
                <div class="form__note" id="adminBanNote"></div>
              </div>
            </form>

            <form class="form" id="adminMakeAdminForm" style="margin-top:12px;">
              <div class="panel" style="padding:12px;">
                <div class="panel__title" style="margin-bottom:10px;">Admin Yap (Anahtar ile)</div>
                <div class="grid grid--2">
                  <div class="field">
                    <label class="label">Kullanıcı adı</label>
                    <input class="input" id="adminMakeUsername" placeholder="örn: yusuf" />
                  </div>
                  <div class="field">
                    <label class="label">Admin anahtarı</label>
                    <input class="input" id="adminKey" type="password" placeholder="db.php içindeki ADMIN_KEY" />
                  </div>
                </div>
                <div class="row row--end">
                  <button class="btn btn--ghost" type="submit">Admin Yap</button>
                </div>
                <div class="form__note" id="adminMakeNote"></div>
              </div>
            </form>

            <div class="form__note" style="margin-top:10px;">
              Mesaj silme: Sohbet ekranında mesaj satırındaki <b>Sil</b> butonu (sadece admin görür).
            </div>
          </div>
        </div>
      </div>
    <?php endif; ?>

    <script src="https://js.pusher.com/8.4.0/pusher.min.js"></script>
    <script>
      const ME = <?=json_encode([
        'id' => (int)$me['id'],
        'username' => $me['username'],
        'is_admin' => $isAdmin,
      ], JSON_UNESCAPED_UNICODE)?>;
      const REALTIME = <?=json_encode([
        'enabled' => realtime_enabled(),
        'key' => PUSHER_KEY,
        'cluster' => PUSHER_CLUSTER,
      ], JSON_UNESCAPED_UNICODE)?>;

      const state = {
        mode: 'room', // room | dm
        room: 'genel',
        dmWithId: null,
        dmWithUser: null,
        lastRoomId: { genel: 0, evlilik: 0, dini: 0 },
        lastDmId: 0,
        dmCanMessage: true,
        selectedUser: null,
        pollTimer: null,
        pollInFlight: false,
      pollIntervalMs: 20000,
        idleLevel: 0,
        isPageVisible: document.visibilityState === 'visible',
        userLastActiveAt: Date.now(),
        isMobileLeftOpen: false,
        isMobileRightOpen: false,
        realtimeConnected: false,
      realtimeClient: null,
        realtimeRoomChannel: null,
        realtimeDmChannel: null,
      unreadDmCount: 0,
      blockedByMeIds: new Set(),
      blockedMeIds: new Set(),
      };

      function qs(sel){ return document.querySelector(sel); }
      function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
      function el(tag, cls){ const n=document.createElement(tag); if(cls) n.className=cls; return n; }
      function escapeText(s){ return String(s === undefined || s === null ? '' : s); }
      function firstChar(s){
        const str = escapeText(s);
        return str.length ? str.charAt(0) : '?';
      }

      async function api(action, {method='GET', body=null} = {}){
        const url = new URL('chat.php', window.location.href);
        url.searchParams.set('action', action);
        const opts = { method };
        if (body && method !== 'GET') {
          const fd = new FormData();
          Object.entries(body).forEach(([k,v]) => fd.append(k, String(v)));
          opts.body = fd;
        }
        const res = await fetch(url.toString(), opts);
        const data = await res.json().catch(()=>({ok:false,error:'JSON hatası'}));
        if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }

      function setOverlay(){
        const show = state.isMobileLeftOpen || state.isMobileRightOpen;
        qs('#overlay').hidden = !show;
      }
      function setMobileSidebar(side, open){
        if (side === 'left') {
          state.isMobileLeftOpen = open;
          qs('#leftSidebar').classList.toggle('is-open', open);
        } else {
          state.isMobileRightOpen = open;
          qs('#rightSidebar').classList.toggle('is-open', open);
        }
        setOverlay();
      }

      function addMessageRow({id, username, userId=null, time, message, deleted, canDelete=false, deleteType='room'}){
        const body = qs('#chatBody');
        const row = el('div', 'msg');
        const av = el('div', 'avatar avatar--md'); av.textContent = firstChar(username).toUpperCase();
        const box = el('div');
        const meta = el('div', 'msg__meta');
        const user = el('button', 'msg__user msg__user--btn');
        user.type = 'button';
        user.textContent = escapeText(username);
        if (userId && userId !== ME.id) {
          user.addEventListener('click', () => {
            const full = { id: userId, username, first_name: '', last_name: '', blocked_by_me: false, blocked_me: false };
            openUserAction(full);
          });
        } else {
          user.disabled = true;
        }
        const t = el('div', 'msg__time'); t.textContent = escapeText(time);
        meta.appendChild(user); meta.appendChild(t);

        if (canDelete) {
          const del = el('button', 'btn btn--ghost');
          del.type = 'button';
          del.textContent = 'Sil';
          del.style.padding = '6px 10px';
          del.style.borderRadius = '10px';
          del.addEventListener('click', async () => {
            try{
              await api('admin_delete', {method:'POST', body:{type: deleteType, id}});
            }catch(e){
              alert(e.message);
            }
          });
          meta.appendChild(del);
        }

        const text = el('div', 'msg__text');
        text.textContent = deleted ? '— silindi —' : escapeText(message);
        box.appendChild(meta);
        box.appendChild(text);
        row.appendChild(av);
        row.appendChild(box);
        body.appendChild(row);
        body.scrollTop = body.scrollHeight;
      }

      function getPollDelay(){
        if (!state.isPageVisible) return 0;
        return 20000;
      }

      function scheduleNextPoll(hasNewMessages = false){
        if (state.pollTimer) clearTimeout(state.pollTimer);
        const delay = getPollDelay(hasNewMessages);
        state.pollIntervalMs = delay;
        if (delay <= 0) return;
        state.pollTimer = setTimeout(runPollCycle, delay);
      }

      function markUserActive(){
        state.userLastActiveAt = Date.now();
        state.idleLevel = 0;
        if (!state.pollInFlight && state.isPageVisible && state.pollIntervalMs > 20000) {
          scheduleNextPoll(false);
        }
      }

      async function pollCombined(){
        const url = new URL('chat.php', window.location.href);
        url.searchParams.set('action', 'poll');
        if (state.mode === 'dm') {
          if (!state.dmWithId) return { hasNew: false };
          url.searchParams.set('mode', 'dm');
          url.searchParams.set('with_user_id', String(state.dmWithId));
          url.searchParams.set('after_id', String(state.lastDmId || 0));
        } else {
          const room = state.room;
          const afterId = state.lastRoomId[room] || 0;
          url.searchParams.set('mode', 'room');
          url.searchParams.set('room', room);
          url.searchParams.set('after_id', String(afterId));
        }

        const res = await fetch(url.toString());
        const data = await res.json();
        if (!res.ok || data.ok === false) return { hasNew: false };

        const msgs = data.messages || [];
        if (state.mode === 'dm') {
          if (typeof data.can_message === 'boolean') {
            state.dmCanMessage = data.can_message;
            updateComposerByDmState();
          }
          msgs.forEach(m => {
            state.lastDmId = Math.max(state.lastDmId || 0, m.id);
            const fromMe = m.from_user_id === ME.id;
            addMessageRow({
              id: m.id,
              username: fromMe ? ME.username : m.username,
              userId: fromMe ? ME.id : m.from_user_id,
              time: m.time,
              message: m.message,
              deleted: m.deleted,
              canDelete: ME.is_admin,
              deleteType: 'dm'
            });
          });
        } else {
          const room = state.room;
          msgs.forEach(m => {
            state.lastRoomId[room] = Math.max(state.lastRoomId[room] || 0, m.id);
            addMessageRow({
              ...m,
              userId: m.user_id || null,
              canDelete: ME.is_admin,
              deleteType: 'room'
            });
          });
        }

        return { hasNew: msgs.length > 0 };
      }

      async function runPollCycle(){
        if (state.pollInFlight || !state.isPageVisible) return;
        state.pollInFlight = true;
        try {
          const result = await pollCombined();
          if (result.hasNew) state.idleLevel = 0;
          else state.idleLevel = Math.min(state.idleLevel + 1, 12);
          scheduleNextPoll(result.hasNew);
        } catch (e) {
          state.idleLevel = Math.min(state.idleLevel + 1, 12);
          scheduleNextPoll(false);
        } finally {
          state.pollInFlight = false;
        }
      }

      function updateDmBadge(){
        const btn = qs('#btnOpenDM');
        if (!btn) return;
        if (state.unreadDmCount > 0) {
          btn.textContent = 'DM (' + state.unreadDmCount + ')';
        } else {
          btn.textContent = 'DM';
        }
      }

      function resetDmBadge(){
        state.unreadDmCount = 0;
        updateDmBadge();
      }

      function handleRealtimeRoom(payload){
        if (!payload || state.mode !== 'room') return;
        if (String(state.room) !== String(payload.room || state.room)) return;
        const m = payload || {};
        const room = state.room;
        const senderId = Number(m.user_id || 0);
        if (senderId > 0 && (state.blockedByMeIds.has(senderId) || state.blockedMeIds.has(senderId))) return;
        if (!m.id || m.id <= (state.lastRoomId[room] || 0)) return;
        state.lastRoomId[room] = m.id;
        addMessageRow({
          id: m.id,
          username: m.username,
          userId: m.user_id || null,
          time: m.time,
          message: m.message,
          deleted: !!m.deleted,
          canDelete: ME.is_admin,
          deleteType: 'room'
        });
      }

      function handleRealtimeDm(payload){
        if (!payload) return;
        const m = payload || {};
        if (!m.id || m.id <= (state.lastDmId || 0)) return;
        if (Number(m.to_user_id || 0) !== Number(ME.id)) return;
        const targetDmId = Number(m.from_user_id || 0);
        if (targetDmId > 0 && (state.blockedByMeIds.has(targetDmId) || state.blockedMeIds.has(targetDmId))) return;
        if (state.mode !== 'dm' || Number(state.dmWithId || 0) !== targetDmId || !state.dmCanMessage) {
          state.unreadDmCount += 1;
          updateDmBadge();
          return;
        }
        state.lastDmId = Math.max(state.lastDmId || 0, m.id);
        const fromMe = Number(m.from_user_id) === Number(ME.id);
        addMessageRow({
          id: m.id,
          username: fromMe ? ME.username : m.username,
          userId: fromMe ? ME.id : Number(m.from_user_id || 0),
          time: m.time,
          message: m.message,
          deleted: !!m.deleted,
          canDelete: ME.is_admin,
          deleteType: 'dm'
        });
      }

      function subscribeRoomChannel(room){
        if (!state.realtimeClient) return;
        if (state.realtimeRoomChannel) {
          state.realtimeRoomChannel.unbind('new-message', handleRealtimeRoom);
          state.realtimeClient.unsubscribe(state.realtimeRoomChannel.name);
          state.realtimeRoomChannel = null;
        }
        state.realtimeRoomChannel = state.realtimeClient.subscribe('room-' + room);
        state.realtimeRoomChannel.bind('new-message', handleRealtimeRoom);
      }

      function initRealtime(){
        if (!REALTIME.enabled || typeof window.Pusher === 'undefined') return;
        try {
          const pusher = new window.Pusher(REALTIME.key, {
            cluster: REALTIME.cluster,
            forceTLS: true
          });
          state.realtimeClient = pusher;
          state.realtimeConnected = true;

          subscribeRoomChannel(state.room);

          state.realtimeDmChannel = pusher.subscribe('dm-' + String(ME.id));
          state.realtimeDmChannel.bind('new-dm', handleRealtimeDm);
        } catch (e) {
          state.realtimeConnected = false;
        }
      }

      function resetChat(){
        qs('#chatBody').innerHTML = '';
      }

      function buildChatUrl(params = {}){
        const url = new URL('chat.php', window.location.href);
        Object.entries(params).forEach(([key, value]) => {
          if (value === null || value === undefined || value === '') {
            url.searchParams.delete(key);
          } else {
            url.searchParams.set(key, String(value));
          }
        });
        return url.toString();
      }

      function navigateToRoom(room){
        window.location.href = buildChatUrl({ view: 'room', room, dm: null });
      }

      function navigateToDm(userId){
        window.location.href = buildChatUrl({ view: 'dm', dm: userId, room: null });
      }

      function setRoomUI(room){
        state.mode = 'room';
        state.room = room;
        state.dmWithId = null;
        state.dmWithUser = null;
        state.dmCanMessage = true;
        qs('#activeRoomLabel').textContent = '# ' + room;
        qs('#chatRoomPill').textContent = '# ' + room;
        resetDmBadge();
        subscribeRoomChannel(room);
        updateComposerByDmState();
        resetChat();
        runPollCycle();
      }

      async function openDMDrawer(){
        qs('#dmDrawer').hidden = false;
      }
      function closeDMDrawer(){ qs('#dmDrawer').hidden = true; }

      function updateComposerByDmState(){
        const input = qs('#messageInput');
        const sendBtn = qs('#btnSend');
        if (state.mode !== 'dm') {
          input.disabled = false;
          sendBtn.disabled = false;
          input.placeholder = 'Mesaj yaz… (Enter gönder)';
          return;
        }
        if (state.dmCanMessage) {
          input.disabled = false;
          sendBtn.disabled = false;
          input.placeholder = 'Özel mesaj yaz…';
          resetDmBadge();
        } else {
          input.disabled = true;
          sendBtn.disabled = true;
          input.placeholder = 'Bu DM engel nedeniyle kapalı.';
        }
      }

      function applyUserActionButtons(){
        const u = state.selectedUser;
        if (!u) return;
        const blockedByMe = !!u.blocked_by_me;
        qs('#btnUserBlock').style.display = blockedByMe ? 'none' : '';
        qs('#btnUserUnblock').style.display = blockedByMe ? '' : 'none';
      }

      function openUserAction(u){
        state.selectedUser = u;
        qs('#uaTitle').textContent = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username;
        qs('#uaSub').textContent = `@${u.username}`;
        qs('#uaNote').textContent = u.blocked_me ? 'Bu kullanıcı sizi engellemiş.' : '';
        applyUserActionButtons();
        qs('#userActionModal').hidden = false;
      }

      function closeUserAction(){
        qs('#userActionModal').hidden = true;
      }

      async function loadDmThreads(){
        const data = await api('dm_threads');
        const wrap = qs('#dmThreads');
        wrap.innerHTML = '';
        state.blockedMeIds.clear();
        if (!data.threads || !data.threads.length) {
          const n = el('div', 'form__note'); n.textContent = 'Henüz DM yok.';
          wrap.appendChild(n);
          return;
        }
        data.threads.forEach((t) => {
          if (t.blocked_me) state.blockedMeIds.add(Number(t.other_id));
          const card = el('button', 'thread-card');
          card.type = 'button';
          const title = el('div', 'thread-card__title');
          title.textContent = `${t.first_name} ${t.last_name} (@${t.username})`;
          const sub = el('div', 'thread-card__sub');
          const blockedTag = t.blocked_by_me || t.blocked_me ? ' · engelli' : '';
          sub.textContent = `${(t.last_message || '').slice(0, 56)} · ${t.last_time}${blockedTag}`;
          card.appendChild(title);
          card.appendChild(sub);
          card.addEventListener('click', () => {
            navigateToDm(t.other_id);
          });
          wrap.appendChild(card);
        });
      }

      async function loadBlockedUsers(){
        const data = await api('blocks');
        const wrap = qs('#blockedUsers');
        wrap.innerHTML = '';
        state.blockedByMeIds.clear();
        if (!data.users || !data.users.length) {
          const n = el('div', 'form__note'); n.textContent = 'Engellenen kullanıcı yok.';
          wrap.appendChild(n);
          return;
        }
        data.users.forEach((u) => {
          state.blockedByMeIds.add(Number(u.id));
          const card = el('div', 'user-card');
          const left = el('div', 'user-card__left');
          const title = el('div', 'user-card__title');
          title.textContent = `${u.first_name} ${u.last_name} (@${u.username})`;
          left.appendChild(title);
          const right = el('div', 'user-card__right');
          const btn = el('button', 'btn btn--ghost');
          btn.type = 'button';
          btn.textContent = 'Engeli Kaldır';
          btn.addEventListener('click', async () => {
            await api('unblock', { method: 'POST', body: { user_id: u.id } });
            state.blockedByMeIds.delete(Number(u.id));
            await loadBlockedUsers();
            await loadDmThreads();
            if (state.mode === 'dm' && state.dmWithId === u.id) {
              state.dmCanMessage = true;
              updateComposerByDmState();
            }
          });
          right.appendChild(btn);
          card.appendChild(left);
          card.appendChild(right);
          wrap.appendChild(card);
        });
      }

      function userCard(u){
        const wrap = el('div','user-card');
        const left = el('div','user-card__left');
        const av = el('div','avatar avatar--md'); av.textContent = firstChar(u && u.username).toUpperCase();
        const meta = el('div'); meta.style.minWidth='0';
        const title = el('div','user-card__title'); title.textContent = `${u.first_name} ${u.last_name} (@${u.username})`;
        const sub = el('div','user-card__sub'); sub.textContent = `${u.city || '—'} · ${u.about ? u.about.slice(0,80) : '—'}`;
        meta.appendChild(title); meta.appendChild(sub);
        left.appendChild(av); left.appendChild(meta);

        const right = el('div','user-card__right');
        const dm = el('button','btn btn--primary'); dm.type='button'; dm.textContent='DM';
        dm.addEventListener('click', () => {
          navigateToDm(u.id);
        });
        right.appendChild(dm);

        const block = el('button','btn btn--ghost'); block.type='button'; block.textContent='Engelle';
        block.addEventListener('click', async () => {
          try {
            await api('block',{method:'POST', body:{user_id:u.id}});
            u.blocked_by_me = true;
            state.blockedByMeIds.add(Number(u.id));
            alert('Engellendi.');
            await loadBlockedUsers();
            await loadDmThreads();
          }
          catch(e){ alert(e.message); }
        });
        right.appendChild(block);

        const unblock = el('button','btn btn--ghost'); unblock.type='button'; unblock.textContent='Engeli Kaldır';
        unblock.style.display = u.blocked_by_me ? '' : 'none';
        unblock.addEventListener('click', async () => {
          try{
            await api('unblock',{method:'POST', body:{user_id:u.id}});
            u.blocked_by_me = false;
            state.blockedByMeIds.delete(Number(u.id));
            unblock.style.display = 'none';
            alert('Engel kaldırıldı.');
            await loadBlockedUsers();
            await loadDmThreads();
          }catch(e){ alert(e.message); }
        });
        right.appendChild(unblock);

        const report = el('button','btn btn--ghost'); report.type='button'; report.textContent='Raporla';
        report.addEventListener('click', async () => {
          const reason = prompt('Rapor nedeni (kısa):');
          if (!reason) return;
          try { await api('report',{method:'POST', body:{user_id:u.id, reason}}); alert('Raporlandı.'); }
          catch(e){ alert(e.message); }
        });
        right.appendChild(report);

        if (ME.is_admin) {
          const ban = el('button','btn btn--ghost'); ban.type='button'; ban.textContent='Ban';
          ban.addEventListener('click', async () => {
            const minutes = Number(prompt('Kaç dakika ban? (örn 60):', '60') || '60');
            try { await api('admin_ban',{method:'POST', body:{user_id:u.id, minutes}}); alert('Banlandı.'); }
            catch(e){ alert(e.message); }
          });
          right.appendChild(ban);
        }

        wrap.appendChild(left);
        wrap.appendChild(right);
        return wrap;
      }

      async function searchUsers(q){
        const url = new URL('chat.php', window.location.href);
        url.searchParams.set('action','users');
        url.searchParams.set('q', q || '');
        const res = await fetch(url.toString());
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data.error || 'Hata');
        return data.users || [];
      }

      function wireUI(){
        qs('#btnToggleLeft').addEventListener('click', () => setMobileSidebar('left', !state.isMobileLeftOpen));
        qs('#btnToggleRight').addEventListener('click', () => setMobileSidebar('right', !state.isMobileRightOpen));
        qs('#overlay').addEventListener('click', () => { setMobileSidebar('left', false); setMobileSidebar('right', false); });

        qs('#roomList').addEventListener('click', (e) => {
          const btn = e.target.closest('.room-item');
          if (!btn) return;
          navigateToRoom(btn.getAttribute('data-room') || 'genel');
        });

        qs('#btnLogout').addEventListener('click', async () => {
          try { await api('logout'); window.location.href = 'login.php'; }
          catch(e){ window.location.href = 'login.php'; }
        });

        const profileModal = qs('#profileModal');
        const closeProfile = () => { profileModal.hidden = true; };
        qs('#btnProfile').addEventListener('click', () => { profileModal.hidden = false; });
        qs('#btnCloseProfile').addEventListener('click', closeProfile);
        profileModal.addEventListener('click', (e) => {
          if (e.target === profileModal) closeProfile(); // backdrop click
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && !profileModal.hidden) closeProfile();
        });

        qs('#profileForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const note = qs('#profileNote');
          note.textContent = '';
          try {
            await api('profile_update', {method:'POST', body:{
              first_name: qs('#pfFirstName').value.trim(),
              last_name: qs('#pfLastName').value.trim(),
              email: qs('#pfEmail').value.trim(),
              phone: qs('#pfPhone').value.trim(),
              city: qs('#pfCity').value.trim(),
              about: qs('#pfAbout').value.trim(),
            }});
            note.textContent = 'Kaydedildi.';
            note.classList.remove('is-bad'); note.classList.add('is-ok');
          } catch (e2) {
            note.textContent = e2.message || 'Hata';
            note.classList.remove('is-ok'); note.classList.add('is-bad');
          }
        });

        qs('#btnOpenDM').addEventListener('click', openDMDrawer);
        qs('#btnQuickDM').addEventListener('click', openDMDrawer);
        qs('#btnOpenUsers').addEventListener('click', openDMDrawer);
        qs('#btnCloseDM').addEventListener('click', closeDMDrawer);

        qs('#btnCloseUserAction').addEventListener('click', closeUserAction);
        qs('#userActionModal').addEventListener('click', (e) => {
          if (e.target === qs('#userActionModal')) closeUserAction();
        });
        qs('#btnUserDmStart').addEventListener('click', () => {
          const u = state.selectedUser;
          if (!u) return;
          navigateToDm(u.id);
        });
        qs('#btnUserBlock').addEventListener('click', async () => {
          const u = state.selectedUser;
          if (!u) return;
          try {
            await api('block', { method:'POST', body:{ user_id: u.id } });
            u.blocked_by_me = true;
            state.blockedByMeIds.add(Number(u.id));
            qs('#uaNote').textContent = 'Kullanıcı engellendi.';
            applyUserActionButtons();
            await loadBlockedUsers();
            await loadDmThreads();
          } catch (e2) {
            qs('#uaNote').textContent = e2.message || 'Hata';
          }
        });
        qs('#btnUserUnblock').addEventListener('click', async () => {
          const u = state.selectedUser;
          if (!u) return;
          try {
            await api('unblock', { method:'POST', body:{ user_id: u.id } });
            u.blocked_by_me = false;
            state.blockedByMeIds.delete(Number(u.id));
            qs('#uaNote').textContent = 'Engel kaldırıldı.';
            applyUserActionButtons();
            await loadBlockedUsers();
            await loadDmThreads();
          } catch (e2) {
            qs('#uaNote').textContent = e2.message || 'Hata';
          }
        });
        qs('#btnUserReport').addEventListener('click', async () => {
          const u = state.selectedUser;
          if (!u) return;
          const reason = prompt('Rapor nedeni (kısa):');
          if (!reason) return;
          try {
            await api('report', { method:'POST', body:{ user_id: u.id, reason } });
            qs('#uaNote').textContent = 'Rapor gönderildi.';
          } catch (e2) {
            qs('#uaNote').textContent = e2.message || 'Hata';
          }
        });

        if (ME.is_admin) {
          const adminBtn = qs('#btnAdminHint');
          const adminModal = qs('#adminModal');
          if (adminBtn && adminModal) {
            const closeAdmin = () => { adminModal.hidden = true; };
            adminBtn.addEventListener('click', () => { adminModal.hidden = false; });
            qs('#btnCloseAdmin').addEventListener('click', closeAdmin);
            adminModal.addEventListener('click', (e) => { if (e.target === adminModal) closeAdmin(); });
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape' && !adminModal.hidden) closeAdmin();
            });

            qs('#adminBanForm').addEventListener('submit', async (e) => {
              e.preventDefault();
              const note = qs('#adminBanNote');
              note.textContent = '';
              try{
                await api('admin_ban_username', {method:'POST', body:{
                  username: qs('#adminBanUsername').value.trim(),
                  minutes: qs('#adminBanMinutes').value
                }});
                note.textContent = 'Ban uygulandı.';
                note.classList.remove('is-bad'); note.classList.add('is-ok');
              }catch(e2){
                note.textContent = e2.message || 'Hata';
                note.classList.remove('is-ok'); note.classList.add('is-bad');
              }
            });

            qs('#adminMakeAdminForm').addEventListener('submit', async (e) => {
              e.preventDefault();
              const note = qs('#adminMakeNote');
              note.textContent = '';
              try{
                await api('admin_make_admin', {method:'POST', body:{
                  username: qs('#adminMakeUsername').value.trim(),
                  key: qs('#adminKey').value
                }});
                note.textContent = 'Kullanıcı admin yapıldı.';
                note.classList.remove('is-bad'); note.classList.add('is-ok');
              }catch(e2){
                note.textContent = e2.message || 'Hata';
                note.classList.remove('is-ok'); note.classList.add('is-bad');
              }
            });
          }
        }

        qs('#dmSearchForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const q = qs('#dmQuery').value.trim();
          const list = qs('#dmResults');
          list.innerHTML = '';
          try{
            const users = await searchUsers(q);
            if (!users.length) {
              const n = el('div','form__note'); n.textContent = 'Sonuç yok.';
              list.appendChild(n);
              return;
            }
            users.forEach(u => list.appendChild(userCard(u)));
          }catch(e2){
            const n = el('div','form__note'); n.textContent = e2.message || 'Hata';
            n.classList.add('is-bad');
            list.appendChild(n);
          }
        });

        const input = qs('#messageInput');
        qs('#composer').addEventListener('submit', async (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          input.value = '';
          try{
            if (state.mode === 'dm') {
              if (!state.dmWithId) return;
              await api('dm_send',{method:'POST', body:{to_user_id: state.dmWithId, message: text}});
              if (!state.pollInFlight) await runPollCycle();
              loadDmThreads();
            } else {
              await api('send',{method:'POST', body:{room: state.room, message: text}});
              if (!state.pollInFlight) await runPollCycle();
            }
            markUserActive();
          }catch(e2){
            alert(e2.message || 'Hata');
          }
        });
      }

      function startPolling(){
        if (state.pollTimer) clearTimeout(state.pollTimer);
        state.pollInFlight = false;
        state.idleLevel = 0;
        scheduleNextPoll(false);
      }

      wireUI();
      loadDmThreads();
      loadBlockedUsers();
      // Kayıt/giriş sonrası açılacak sohbet URL'den belirlenir.
      (() => {
        const params = new URLSearchParams(window.location.search);
        const view = params.get('view');
        const dmId = Number(params.get('dm') || '0');
        const room = params.get('room') || 'genel';

        if (view === 'dm' && dmId > 0) {
          state.mode = 'dm';
          state.dmWithId = dmId;
          state.dmWithUser = null;
          state.lastDmId = 0;
          qs('#activeRoomLabel').textContent = `DM · #${dmId}`;
          qs('#chatRoomPill').textContent = `DM · #${dmId}`;
          resetChat();
          updateComposerByDmState();
          runPollCycle();
          return;
        }

        qsa('.room-item').forEach(x => x.classList.toggle('is-active', x.getAttribute('data-room') === room));
        setRoomUI(room);
      })();
      initRealtime();
      ['mousemove','keydown','click','touchstart','scroll'].forEach((evt) => {
        window.addEventListener(evt, markUserActive, { passive: true });
      });
      document.addEventListener('visibilitychange', () => {
        state.isPageVisible = document.visibilityState === 'visible';
        if (state.isPageVisible) {
          markUserActive();
          runPollCycle();
        } else if (state.pollTimer) {
          clearTimeout(state.pollTimer);
          state.pollTimer = null;
        }
      });
      startPolling();
    </script>
  </body>
</html>

