<?php
header('Content-Type: application/json');

$audioDir = __DIR__ . '/audios/';
$lyricsDir = __DIR__ . '/lyrics/';
$exts = ['mp3', 'wav', 'ogg', 'm4a'];

$songs = [];

if (is_dir($audioDir)) {
    foreach (scandir($audioDir) as $file) {
        if ($file === '.' || $file === '..') continue;
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        if (!in_array($ext, $exts)) continue;

        $base = pathinfo($file, PATHINFO_FILENAME);
        $lrcFile = $lyricsDir . $base . '.lrc';

        $songs[] = [
            'title'  => $base,
            'file'   => 'audios/' . rawurlencode($file),
            'lyrics' => file_exists($lrcFile) ? 'lyrics/' . rawurlencode($base . '.lrc') : null,
        ];
    }
}

echo json_encode($songs);
