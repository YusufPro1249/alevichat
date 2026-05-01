<?php
declare(strict_types=1);

// MySQL bağlantı bilgileri
// Not: Paylaşımlı hostinglerde genelde .env kullanılmaz; bu dosyayı düzenlemeniz yeterli.

const DB_HOST = 'sql108.infinityfree.com';
const DB_NAME = 'if0_41790125_alevichat';
const DB_USER = 'if0_41790125';
const DB_PASS = 'DBVAwyCbtMH0u';

// İlk admin oluşturma anahtarı (Admin panelinden "Admin Yap" için)
const ADMIN_KEY = 'change_me_admin_key';

// Realtime (Pusher) - ücretsiz plana geçiş için
const PUSHER_ENABLED = false; // true yapınca aktif olur
const PUSHER_APP_ID = '2148862';
const PUSHER_KEY = '584f5e972133095324b6';
const PUSHER_SECRET = 'ab3c8018cb71006131fb';
const PUSHER_CLUSTER = 'eu';

// Basit rate limit
const RL_WINDOW_SEC = 60;
const RL_MAX_REQ = 160;

function pdo(): PDO {
  static $pdo = null;
  if ($pdo instanceof PDO) return $pdo;

  $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
  $pdo = new PDO($dsn, DB_USER, DB_PASS, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
  ]);

  return $pdo;
}

function ensure_schema(): void {
  // InfinityFree gibi paylasimli hostinglerde her istekte schema kontrolu
  // yapmak CPU/DB limitini cok hizli doldurabilir.
  start_session();
  if (!empty($_SESSION['schema_ready']) && (int)($_SESSION['schema_ready']) === 1) {
    return;
  }

  $db = pdo();

  $db->exec("CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(80) NOT NULL,
    last_name VARCHAR(80) NOT NULL,
    username VARCHAR(40) NOT NULL UNIQUE,
    email VARCHAR(190) NOT NULL UNIQUE,
    phone VARCHAR(40) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    city VARCHAR(120) NOT NULL,
    about VARCHAR(280) NOT NULL DEFAULT '',
    role ENUM('user','admin') NOT NULL DEFAULT 'user',
    banned_until DATETIME NULL DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $db->exec("CREATE TABLE IF NOT EXISTS rooms (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(20) NOT NULL UNIQUE,
    title VARCHAR(40) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $db->exec("CREATE TABLE IF NOT EXISTS room_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    room_slug VARCHAR(20) NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_by INT UNSIGNED NULL DEFAULT NULL,
    INDEX idx_room_time (room_slug, created_at),
    CONSTRAINT fk_roommsg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $db->exec("CREATE TABLE IF NOT EXISTS dm_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    from_user_id INT UNSIGNED NOT NULL,
    to_user_id INT UNSIGNED NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_by INT UNSIGNED NULL DEFAULT NULL,
    INDEX idx_dm_pair_time (from_user_id, to_user_id, created_at),
    INDEX idx_dm_rev_pair_time (to_user_id, from_user_id, created_at),
    CONSTRAINT fk_dm_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_dm_to FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $db->exec("CREATE TABLE IF NOT EXISTS blocks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    blocked_user_id INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_block (user_id, blocked_user_id),
    CONSTRAINT fk_block_u FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_block_b FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  $db->exec("CREATE TABLE IF NOT EXISTS reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    reporter_id INT UNSIGNED NOT NULL,
    target_user_id INT UNSIGNED NOT NULL,
    reason VARCHAR(500) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_r FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_report_t FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

  // seed rooms
  $stmt = $db->prepare("INSERT IGNORE INTO rooms (slug, title) VALUES
    ('genel','Genel'),
    ('evlilik','Evlilik'),
    ('dini','Dini')");
  $stmt->execute();

  // performance indexes for after_id based polling
  ensure_index($db, 'room_messages', 'idx_room_slug_id', 'CREATE INDEX idx_room_slug_id ON room_messages (room_slug, id)');
  ensure_index($db, 'dm_messages', 'idx_dm_pair_id', 'CREATE INDEX idx_dm_pair_id ON dm_messages (from_user_id, to_user_id, id)');
  ensure_index($db, 'dm_messages', 'idx_dm_rev_pair_id', 'CREATE INDEX idx_dm_rev_pair_id ON dm_messages (to_user_id, from_user_id, id)');

  $_SESSION['schema_ready'] = 1;
}

function h(?string $s): string {
  return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function json_out(array $data, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function start_session(): void {
  if (session_status() === PHP_SESSION_NONE) {
    session_start();
  }
}

function current_user_id(): ?int {
  start_session();
  return isset($_SESSION['uid']) ? (int)$_SESSION['uid'] : null;
}

function require_login(): int {
  $uid = current_user_id();
  if (!$uid) {
    header('Location: login.php');
    exit;
  }
  return $uid;
}

function get_user(int $uid): ?array {
  $db = pdo();
  $stmt = $db->prepare("SELECT id, first_name, last_name, username, email, phone, city, about, role, banned_until FROM users WHERE id=?");
  $stmt->execute([$uid]);
  $u = $stmt->fetch();
  return $u ?: null;
}

function is_banned(array $u): bool {
  if (!$u['banned_until']) return false;
  return strtotime($u['banned_until']) > time();
}

function is_admin(array $u): bool {
  return ($u['role'] ?? '') === 'admin';
}

function rate_limit(string $bucket = 'global'): void {
  start_session();
  $key = 'rl_' . $bucket;
  $now = time();

  if (!isset($_SESSION[$key])) {
    $_SESSION[$key] = ['t' => $now, 'c' => 1];
    return;
  }

  $t = (int)($_SESSION[$key]['t'] ?? $now);
  $c = (int)($_SESSION[$key]['c'] ?? 0);

  if ($now - $t >= RL_WINDOW_SEC) {
    $_SESSION[$key] = ['t' => $now, 'c' => 1];
    return;
  }

  $c++;
  $_SESSION[$key]['c'] = $c;

  if ($c > RL_MAX_REQ) {
    json_out(['ok' => false, 'error' => 'Rate limit aşıldı. Lütfen biraz bekleyin.'], 429);
  }
}

function can_talk(int $fromId, int $toId): bool {
  $db = pdo();
  // either direction block -> deny
  $stmt = $db->prepare("SELECT 1 FROM blocks WHERE (user_id=? AND blocked_user_id=?) OR (user_id=? AND blocked_user_id=?) LIMIT 1");
  $stmt->execute([$fromId, $toId, $toId, $fromId]);
  return $stmt->fetch() ? false : true;
}

function ensure_index(PDO $db, string $table, string $indexName, string $createSql): void {
  try {
    $stmt = $db->prepare("SHOW INDEX FROM `{$table}` WHERE Key_name = ?");
    $stmt->execute([$indexName]);
    $exists = (bool)$stmt->fetch();
    if (!$exists) {
      $db->exec($createSql);
    }
  } catch (Throwable $e) {
    // Shared hostinglerde index metadata/DDL izinleri kısıtlı olabilir.
    // Login/chat akışını kırmamak için burada sessiz geçiyoruz.
  }
}

function realtime_enabled(): bool {
  return PUSHER_ENABLED
    && PUSHER_APP_ID !== ''
    && PUSHER_KEY !== ''
    && PUSHER_SECRET !== ''
    && PUSHER_CLUSTER !== '';
}

function pusher_trigger(string $channel, string $event, array $payload): void {
  if (!realtime_enabled()) return;

  $path = '/apps/' . rawurlencode(PUSHER_APP_ID) . '/events';
  $url = 'https://api-' . PUSHER_CLUSTER . '.pusher.com' . $path;
  $bodyArr = [
    'name' => $event,
    'channels' => [$channel],
    'data' => json_encode($payload, JSON_UNESCAPED_UNICODE),
  ];
  $body = json_encode($bodyArr, JSON_UNESCAPED_UNICODE);
  if ($body === false) return;

  $params = [
    'auth_key' => PUSHER_KEY,
    'auth_timestamp' => (string)time(),
    'auth_version' => '1.0',
    'body_md5' => md5($body),
  ];
  ksort($params);
  $query = http_build_query($params, '', '&', PHP_QUERY_RFC3986);
  $toSign = "POST\n{$path}\n{$query}";
  $signature = hash_hmac('sha256', $toSign, PUSHER_SECRET);
  $requestUrl = $url . '?' . $query . '&auth_signature=' . $signature;

  if (function_exists('curl_init')) {
    $ch = curl_init($requestUrl);
    if ($ch === false) return;
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3);
    curl_exec($ch);
    curl_close($ch);
    return;
  }

  $ctx = stream_context_create([
    'http' => [
      'method' => 'POST',
      'header' => "Content-Type: application/json\r\n",
      'content' => $body,
      'timeout' => 3,
    ],
  ]);
  @file_get_contents($requestUrl, false, $ctx);
}

