<?php
declare(strict_types=1);
require_once __DIR__ . '/db.php';
ensure_schema();
start_session();

$uid = current_user_id();
if ($uid) {
  header('Location: chat.php');
  exit;
}

header('Location: login.php');
exit;

