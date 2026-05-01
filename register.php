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
$ok = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  rate_limit('register');

  $first = trim((string)($_POST['first_name'] ?? ''));
  $last = trim((string)($_POST['last_name'] ?? ''));
  $username = strtolower(trim((string)($_POST['username'] ?? '')));
  $email = strtolower(trim((string)($_POST['email'] ?? '')));
  $phone = trim((string)($_POST['phone'] ?? ''));
  $password = (string)($_POST['password'] ?? '');
  $city = trim((string)($_POST['city'] ?? ''));
  $about = trim((string)($_POST['about'] ?? ''));

  if ($first === '' || $last === '' || $username === '' || $email === '' || $phone === '' || $password === '' || $city === '') {
    $error = 'Lütfen tüm zorunlu alanları doldurun.';
  } elseif (strlen($password) < 6) {
    $error = 'Şifre en az 6 karakter olmalı.';
  } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $error = 'Email geçersiz.';
  } elseif (!preg_match('/^[a-z0-9_\.]{3,20}$/', $username)) {
    $error = 'Kullanıcı adı 3-20 karakter; a-z, 0-9, _ ve . içerebilir.';
  } else {
    try {
      $db = pdo();
      $stmt = $db->prepare("SELECT id FROM users WHERE username=? OR email=? LIMIT 1");
      $stmt->execute([$username, $email]);
      if ($stmt->fetch()) {
        $error = 'Kullanıcı adı veya email zaten kayıtlı.';
      } else {
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $db->prepare("INSERT INTO users (first_name,last_name,username,email,phone,password_hash,city,about) VALUES (?,?,?,?,?,?,?,?)");
        $stmt->execute([
          $first,
          $last,
          $username,
          $email,
          $phone,
          $hash,
          $city,
          mb_substr($about, 0, 280),
        ]);
        $uid = (int)$db->lastInsertId();
        $_SESSION['uid'] = $uid;
        header('Location: chat.php');
        exit;
      }
    } catch (Throwable $e) {
      $error = 'Kayıt sırasında hata oluştu.';
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
    <title>AleviChat — Kayıt</title>
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
            <div class="modal__title">Kayıt Ol</div>
            <div class="modal__sub">Topluluğa katılın, sohbet edin.</div>
          </div>
          <a class="icon-btn" href="login.php" aria-label="Girişe dön">
            <span class="icon icon--close"></span>
          </a>
        </div>

        <div class="modal__body">
          <form class="form" method="post" autocomplete="off">
            <div class="grid grid--2">
              <div class="field">
                <label class="label">Ad</label>
                <input class="input" name="first_name" required value="<?=h($_POST['first_name'] ?? '')?>" />
              </div>
              <div class="field">
                <label class="label">Soyad</label>
                <input class="input" name="last_name" required value="<?=h($_POST['last_name'] ?? '')?>" />
              </div>
            </div>
            <div class="grid grid--2">
              <div class="field">
                <label class="label">Kullanıcı Adı</label>
                <input class="input" name="username" required value="<?=h($_POST['username'] ?? '')?>" />
              </div>
              <div class="field">
                <label class="label">Email</label>
                <input class="input" type="email" name="email" required value="<?=h($_POST['email'] ?? '')?>" />
              </div>
            </div>
            <div class="grid grid--2">
              <div class="field">
                <label class="label">Telefon</label>
                <input class="input" name="phone" required value="<?=h($_POST['phone'] ?? '')?>" />
              </div>
              <div class="field">
                <label class="label">Şehir</label>
                <input class="input" name="city" required value="<?=h($_POST['city'] ?? '')?>" />
              </div>
            </div>
            <div class="field">
              <label class="label">Şifre</label>
              <input class="input" type="password" name="password" required minlength="6" />
            </div>
            <div class="field">
              <label class="label">Hakkında</label>
              <textarea class="input input--ta" name="about" rows="3" maxlength="280"><?=h($_POST['about'] ?? '')?></textarea>
            </div>

            <div class="row row--end">
              <button class="btn btn--primary btn--wide" type="submit">Hesap Oluştur</button>
            </div>

            <?php if ($error): ?>
              <div class="form__note is-bad"><?=h($error)?></div>
            <?php else: ?>
              <div class="form__note"><?=h($ok)?></div>
            <?php endif; ?>

            <div class="form__note">
              Zaten hesabın var mı? <a href="login.php" style="color: var(--primary-2); font-weight:800; text-decoration:none;">Giriş yap</a>
            </div>
          </form>
        </div>
      </div>
    </div>
  </body>
</html>

