<?php
declare(strict_types=1);

/*
 * Dispatch an email via the credentials on an email_providers row.
 * Returns [bool ok, ?string errorMsg].
 *
 * Input: $providerRow  — the full DB row from email_providers
 *        $msg          — ['to', 'subject', 'html', 'text']
 *
 * This is deliberately kept as a single-file helper (no PSR autoload
 * dance, no external SDKs) so it works out-of-the-box on shared XAMPP
 * without needing composer packages per-provider. It uses each
 * provider's REST API over cURL where available, falls back to raw
 * SMTP via fsockopen for the 'smtp' provider.
 *
 * When credentials are wrong, providers return a clear JSON error which
 * we bubble up as the errorMsg so the UI can show it on the provider
 * row.
 */

return function (array $providerRow, array $msg): array {
    $provider = (string)$providerRow['provider'];
    $to       = (string)$msg['to'];
    $subject  = (string)$msg['subject'];
    $html     = (string)($msg['html'] ?? '');
    $text     = (string)($msg['text'] ?? strip_tags($html));

    $fromEmail = (string)$providerRow['from_email'];
    $fromName  = trim((string)($providerRow['from_name'] ?? ''));
    $from      = $fromName !== '' ? "$fromName <$fromEmail>" : $fromEmail;
    $replyTo   = trim((string)($providerRow['reply_to'] ?? ''));

    // Advanced: merge tenant-configured custom headers on top of any
    // defaults. Parsed once here so every provider branch can pull them.
    $customHeaders = [];
    $chRaw = (string)($providerRow['custom_headers_json'] ?? '');
    if ($chRaw !== '') {
        $decoded = json_decode($chRaw, true);
        if (is_array($decoded)) {
            foreach ($decoded as $k => $v) {
                if (is_string($k) && (is_string($v) || is_numeric($v))) {
                    $customHeaders[$k] = (string)$v;
                }
            }
        }
    }

    // Shared cURL helper — returns [http_code, body, error].
    $httpPost = static function (string $url, array $headers, string $body): array {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_TIMEOUT        => 20,
        ]);
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        return [$code, (string)$resp, (string)$err];
    };

    switch ($provider) {
        case 'postmark': {
            $key = (string)($providerRow['api_key'] ?? '');
            if ($key === '') return [false, 'Missing api_key for Postmark'];
            $payload = [
                'From'          => $from,
                'To'            => $to,
                'Subject'       => $subject,
                'HtmlBody'      => $html,
                'TextBody'      => $text,
                'MessageStream' => 'outbound',
            ];
            if ($replyTo !== '') $payload['ReplyTo'] = $replyTo;
            if ($customHeaders) {
                $payload['Headers'] = [];
                foreach ($customHeaders as $k => $v) $payload['Headers'][] = ['Name' => $k, 'Value' => $v];
            }
            [$code, $resp, $curlErr] = $httpPost(
                'https://api.postmarkapp.com/email',
                ['Accept: application/json', 'Content-Type: application/json', 'X-Postmark-Server-Token: ' . $key],
                json_encode($payload, JSON_UNESCAPED_UNICODE) ?: ''
            );
            if ($curlErr !== '') return [false, "cURL: $curlErr"];
            if ($code >= 200 && $code < 300) return [true, null];
            return [false, "Postmark $code: " . substr($resp, 0, 500)];
        }

        case 'resend': {
            $key = (string)($providerRow['api_key'] ?? '');
            if ($key === '') return [false, 'Missing api_key for Resend'];
            $payload = [
                'from'    => $from,
                'to'      => [$to],
                'subject' => $subject,
                'html'    => $html,
                'text'    => $text,
            ];
            if ($replyTo !== '') $payload['reply_to'] = $replyTo;
            if ($customHeaders) $payload['headers'] = $customHeaders;
            [$code, $resp, $curlErr] = $httpPost(
                'https://api.resend.com/emails',
                ['Content-Type: application/json', 'Authorization: Bearer ' . $key],
                json_encode($payload, JSON_UNESCAPED_UNICODE) ?: ''
            );
            if ($curlErr !== '') return [false, "cURL: $curlErr"];
            if ($code >= 200 && $code < 300) return [true, null];
            return [false, "Resend $code: " . substr($resp, 0, 500)];
        }

        case 'sendgrid': {
            $key = (string)($providerRow['api_key'] ?? '');
            if ($key === '') return [false, 'Missing api_key for SendGrid'];
            $payload = [
                'personalizations' => [['to' => [['email' => $to]]]],
                'from'             => ['email' => $fromEmail, 'name' => $fromName ?: null],
                'subject'          => $subject,
                'content'          => [
                    ['type' => 'text/plain', 'value' => $text],
                    ['type' => 'text/html',  'value' => $html],
                ],
            ];
            if ($replyTo !== '') $payload['reply_to'] = ['email' => $replyTo];
            if ($customHeaders) $payload['headers'] = $customHeaders;
            [$code, $resp, $curlErr] = $httpPost(
                'https://api.sendgrid.com/v3/mail/send',
                ['Content-Type: application/json', 'Authorization: Bearer ' . $key],
                json_encode($payload, JSON_UNESCAPED_UNICODE) ?: ''
            );
            if ($curlErr !== '') return [false, "cURL: $curlErr"];
            if ($code >= 200 && $code < 300) return [true, null];
            return [false, "SendGrid $code: " . substr($resp, 0, 500)];
        }

        case 'brevo': {
            $key = (string)($providerRow['api_key'] ?? '');
            if ($key === '') return [false, 'Missing api_key for Brevo'];
            $payload = [
                'sender'      => ['email' => $fromEmail, 'name' => $fromName ?: null],
                'to'          => [['email' => $to]],
                'subject'     => $subject,
                'htmlContent' => $html,
                'textContent' => $text,
            ];
            if ($replyTo !== '') $payload['replyTo'] = ['email' => $replyTo];
            if ($customHeaders) $payload['headers'] = $customHeaders;
            [$code, $resp, $curlErr] = $httpPost(
                'https://api.brevo.com/v3/smtp/email',
                ['Accept: application/json', 'Content-Type: application/json', 'api-key: ' . $key],
                json_encode($payload, JSON_UNESCAPED_UNICODE) ?: ''
            );
            if ($curlErr !== '') return [false, "cURL: $curlErr"];
            if ($code >= 200 && $code < 300) return [true, null];
            return [false, "Brevo $code: " . substr($resp, 0, 500)];
        }

        case 'mailersend': {
            $key = (string)($providerRow['api_key'] ?? '');
            if ($key === '') return [false, 'Missing api_key for MailerSend'];
            $payload = [
                'from'    => ['email' => $fromEmail, 'name' => $fromName ?: null],
                'to'      => [['email' => $to]],
                'subject' => $subject,
                'html'    => $html,
                'text'    => $text,
            ];
            if ($replyTo !== '') $payload['reply_to'] = ['email' => $replyTo];
            if ($customHeaders) {
                // MailerSend expects headers as an array of {name, value}
                $payload['headers'] = [];
                foreach ($customHeaders as $k => $v) $payload['headers'][] = ['name' => $k, 'value' => $v];
            }
            [$code, $resp, $curlErr] = $httpPost(
                'https://api.mailersend.com/v1/email',
                ['Content-Type: application/json', 'Authorization: Bearer ' . $key],
                json_encode($payload, JSON_UNESCAPED_UNICODE) ?: ''
            );
            if ($curlErr !== '') return [false, "cURL: $curlErr"];
            if ($code >= 200 && $code < 300) return [true, null];
            return [false, "MailerSend $code: " . substr($resp, 0, 500)];
        }

        case 'mailgun': {
            $key    = (string)($providerRow['api_key'] ?? '');
            $domain = (string)($providerRow['mailgun_domain'] ?? '');
            if ($key === '' || $domain === '') return [false, 'Mailgun needs api_key + mailgun_domain'];
            $mgFields = [
                'from'    => $from,
                'to'      => $to,
                'subject' => $subject,
                'text'    => $text,
                'html'    => $html,
                'h:Reply-To' => $replyTo !== '' ? $replyTo : null,
            ];
            // Mailgun takes custom headers as `h:X-Header-Name` fields.
            foreach ($customHeaders as $k => $v) $mgFields['h:' . $k] = $v;
            $body = http_build_query(array_filter($mgFields, static fn($v) => $v !== null));
            $ch = curl_init('https://api.mailgun.net/v3/' . rawurlencode($domain) . '/messages');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $body,
                CURLOPT_USERPWD        => 'api:' . $key,
                CURLOPT_TIMEOUT        => 20,
            ]);
            $resp = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlErr = curl_error($ch);
            curl_close($ch);
            if ($curlErr !== '') return [false, "cURL: $curlErr"];
            if ($code >= 200 && $code < 300) return [true, null];
            return [false, "Mailgun $code: " . substr((string)$resp, 0, 500)];
        }

        case 'ses': {
            // Amazon SES SigV4 signing is non-trivial; delegate to
            // AWS SES SMTP endpoint using the SMTP credentials the
            // tenant generated in the SES console. Easier than
            // rolling SigV4 by hand and works fine at low volume.
            // (For higher volume, swap to the SendEmail API via
            // the aws-sdk-php package once composer is available.)
            $region = trim((string)($providerRow['aws_region'] ?? ''));
            if ($region === '') return [false, 'AWS region required (e.g. eu-west-1)'];
            $host = "email-smtp.$region.amazonaws.com";
            return _smtpSend([
                'host'       => $host,
                'port'       => 587,
                'encryption' => 'tls',
                'user'       => (string)($providerRow['api_key']    ?? ''),
                'password'   => (string)($providerRow['api_secret'] ?? ''),
            ], $from, $to, $subject, $text, $html, $replyTo, $customHeaders);
        }

        case 'smtp': {
            return _smtpSend([
                'host'       => (string)($providerRow['smtp_host'] ?? ''),
                'port'       => (int)($providerRow['smtp_port']   ?? 587),
                'encryption' => (string)($providerRow['smtp_encryption'] ?? 'tls'),
                'user'       => (string)($providerRow['smtp_user']     ?? ''),
                'password'   => (string)($providerRow['smtp_password'] ?? ''),
            ], $from, $to, $subject, $text, $html, $replyTo, $customHeaders);
        }
    }

    return [false, "Unknown provider: $provider"];
};

/**
 * Minimal SMTP client — plain AUTH LOGIN + STARTTLS. Used by the 'smtp'
 * provider and the 'ses' fallback. Not suitable for high volume, but
 * correct enough for test sends and low-throughput transactional mail.
 */
function _smtpSend(array $cfg, string $from, string $to, string $subject, string $text, string $html, string $replyTo, array $customHeaders = []): array {
    $host = $cfg['host']; $port = (int)$cfg['port']; $enc = $cfg['encryption'];
    $user = $cfg['user']; $pass = $cfg['password'];
    if ($host === '' || $port === 0) return [false, 'SMTP host/port required'];

    $transport = $enc === 'ssl' ? "ssl://$host" : $host;
    $fp = @stream_socket_client("$transport:$port", $errno, $errstr, 10);
    if (!$fp) return [false, "SMTP connect failed: $errstr ($errno)"];
    stream_set_timeout($fp, 15);

    $read = static function ($fp): string {
        $buf = '';
        while (!feof($fp)) {
            $line = fgets($fp, 512);
            if ($line === false) break;
            $buf .= $line;
            // multi-line replies use "-" after the code, final line uses " "
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        return $buf;
    };
    $write = static function ($fp, string $cmd) { fwrite($fp, $cmd . "\r\n"); };
    $expect = static function (string $reply, string $want) use ($fp): bool {
        return strncmp($reply, $want, 3) === 0;
    };

    $reply = $read($fp);
    if (!$expect($reply, '220')) { fclose($fp); return [false, "SMTP banner: " . trim($reply)]; }

    $write($fp, "EHLO builtrightstudio.local");
    $reply = $read($fp);
    if (!$expect($reply, '250')) { fclose($fp); return [false, "EHLO failed: " . trim($reply)]; }

    if ($enc === 'tls') {
        $write($fp, 'STARTTLS');
        $reply = $read($fp);
        if (!$expect($reply, '220')) { fclose($fp); return [false, "STARTTLS failed: " . trim($reply)]; }
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            fclose($fp); return [false, 'STARTTLS negotiation failed'];
        }
        $write($fp, "EHLO builtrightstudio.local");
        $reply = $read($fp);
        if (!$expect($reply, '250')) { fclose($fp); return [false, "post-TLS EHLO: " . trim($reply)]; }
    }

    if ($user !== '') {
        $write($fp, 'AUTH LOGIN');
        $reply = $read($fp);
        if (!$expect($reply, '334')) { fclose($fp); return [false, "AUTH LOGIN: " . trim($reply)]; }
        $write($fp, base64_encode($user));
        $reply = $read($fp);
        if (!$expect($reply, '334')) { fclose($fp); return [false, "AUTH user: " . trim($reply)]; }
        $write($fp, base64_encode($pass));
        $reply = $read($fp);
        if (!$expect($reply, '235')) { fclose($fp); return [false, "AUTH pass: " . trim($reply)]; }
    }

    // Envelope
    preg_match('/<([^>]+)>|(\S+@\S+)/', $from, $m);
    $envFrom = $m[1] ?? ($m[2] ?? $from);
    $write($fp, "MAIL FROM:<$envFrom>");
    $reply = $read($fp);
    if (!$expect($reply, '250')) { fclose($fp); return [false, "MAIL FROM: " . trim($reply)]; }
    $write($fp, "RCPT TO:<$to>");
    $reply = $read($fp);
    if (!$expect($reply, '250') && !$expect($reply, '251')) { fclose($fp); return [false, "RCPT TO: " . trim($reply)]; }
    $write($fp, 'DATA');
    $reply = $read($fp);
    if (!$expect($reply, '354')) { fclose($fp); return [false, "DATA: " . trim($reply)]; }

    // Message body — multipart alternative
    $boundary = 'bnd-' . bin2hex(random_bytes(8));
    $headers  = [];
    $headers[] = "From: $from";
    $headers[] = "To: $to";
    if ($replyTo !== '') $headers[] = "Reply-To: $replyTo";
    // Tenant-configured custom headers — filter to sane RFC-5322 names
    // and skip anything that would collide with our own envelope.
    $reserved = ['from','to','reply-to','subject','mime-version','content-type','content-transfer-encoding'];
    foreach ($customHeaders as $k => $v) {
        $kNorm = strtolower(trim($k));
        if ($kNorm === '' || in_array($kNorm, $reserved, true)) continue;
        if (!preg_match('/^[A-Za-z0-9-]+$/', $k)) continue;
        // Strip newlines out of the value to defeat header injection.
        $v = str_replace(["\r", "\n"], '', $v);
        $headers[] = "$k: $v";
    }
    $headers[] = "Subject: $subject";
    $headers[] = 'MIME-Version: 1.0';
    $headers[] = "Content-Type: multipart/alternative; boundary=\"$boundary\"";
    $body  = implode("\r\n", $headers) . "\r\n\r\n";
    $body .= "--$boundary\r\n";
    $body .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
    $body .= $text . "\r\n\r\n";
    $body .= "--$boundary\r\n";
    $body .= "Content-Type: text/html; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
    $body .= $html . "\r\n\r\n";
    $body .= "--$boundary--\r\n.\r\n";

    // Dot-stuff any lines that start with "."
    $body = preg_replace('/^\./m', '..', $body) ?? $body;

    fwrite($fp, $body);
    $reply = $read($fp);
    fclose($fp);
    if (!$expect($reply, '250')) return [false, "DATA reply: " . trim($reply)];
    return [true, null];
}
