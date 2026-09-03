USE `builtrightstudio_cms`;

-- Default admin: uwana89@gmail.com / admin123  (change after first login!)
INSERT IGNORE INTO `admin_users` (`email`, `password_hash`, `display_name`)
VALUES ('uwana89@gmail.com',
        '$2y$10$zpwnsyDp1ehWX72ORtZct.0ooXBs/Xss7hIgk6HAWMSDzExUIU6.e',
        'Admin');

-- Default settings (blank SMTP — fill via Settings UI)
INSERT IGNORE INTO `settings` (`k`,`v`) VALUES
  ('smtp_host', ''),
  ('smtp_port', '587'),
  ('smtp_user', ''),
  ('smtp_pass', ''),
  ('smtp_secure', 'tls'),
  ('smtp_from_email', ''),
  ('smtp_from_name', 'BuiltRightStudio'),
  ('brand_name', 'BuiltRightStudio'),
  ('brand_logo_url', ''),
  ('upload_max_mb', '10');
