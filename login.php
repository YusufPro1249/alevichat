<?php
declare(strict_types=1);
require_once __DIR__ . '/db.php';
ensure_schema();
start_session();

if (current_user_id()) {
  header('Location: chat.php');
  exit;
}

$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  rate_limit('login');
  $identity = strtolower(trim((string)($_POST['identity'] ?? '')));
  $password = (string)($_POST['password'] ?? '');

  if ($identity === '' || $password === '') {
    $error = 'Lütfen bilgileri girin.';
  } else {
    $db = pdo();
    $stmt = $db->prepare("SELECT id, password_hash, banned_until FROM users WHERE email=? OR username=? LIMIT 1");
    $stmt->execute([$identity, $identity]);
    $u = $stmt->fetch();
    if (!$u) {
      $error = 'Hatalı bilgiler.';
    } else {
      if ($u['banned_until'] && strtotime($u['banned_until']) > time()) {
        $error = 'Bu hesap banlı.';
      } elseif (!password_verify($password, (string)$u['password_hash'])) {
        $error = 'Hatalı bilgiler.';
      } else {
        $_SESSION['uid'] = (int)$u['id'];
        header('Location: chat.php');
        exit;
      }
    }
  }
}
?>
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>AleviChat — Giriş</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body class="is-auth">
    <div class="modal" id="authModal">
      <div class="modal__dialog">
        <div class="modal__header">
          <div>
            <div class="modal__title">Giriş Yap</div>
            <div class="modal__sub">Topluluğa katılın, sohbet edin, tanışın.</div>
          </div>
          <span class="icon-btn" style="visibility:hidden;">
            <span class="icon icon--close"></span>
          </span>
        </div>

        <div class="modal__body">
          <form class="form" method="post" autocomplete="off">
            <div class="field">
              <label class="label">Email veya Kullanıcı Adı</label>
              <input class="input" name="identity" required value="<?=h($_POST['identity'] ?? '')?>" />
            </div>
            <div class="field">
              <label class="label">Şifre</label>
              <input class="input" type="password" name="password" required />
            </div>
            <div class="row row--end">
              <button class="btn btn--primary btn--wide" type="submit">Giriş</button>
            </div>
            <?php if ($error): ?>
              <div class="form__note is-bad"><?=h($error)?></div>
            <?php else: ?>
              <div class="form__note"></div>
            <?php endif; ?>

            <div class="form__note">
              Hesabın yok mu? <a href="register.php" style="color: var(--primary-2); font-weight:800; text-decoration:none;">Kayıt ol</a>
            </div>
          </form>
        </div>
      </div>
    </div>
  </body>
</html>

