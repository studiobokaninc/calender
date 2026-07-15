import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Button, Typography, Paper, Dialog, DialogTitle,
  DialogContent, DialogActions, CircularProgress, Alert, IconButton, Tooltip
} from '@mui/material';
import {
  Mic as MicIcon,
  Stop as StopIcon,
  Pause as PauseIcon,
  PlayArrow as PlayArrowIcon,
  VolumeOff as VolumeOffIcon,
  VolumeUp as VolumeUpIcon,
  Warning as WarningIcon
} from '@mui/icons-material';
import api from '../services/api';
import { saveChunk, deleteChunk, getUnsentChunks, clearMeetingChunks } from '../utils/indexedDB';

interface MeetingRecorderProps {
  projectId: number;
  onRecordingComplete: () => void;
}

interface SavedRecording {
  meetingId: number;
  meetingUuid: string;
  projectId: number;
  title: string;
  startTime: number;
}

const MeetingRecorder: React.FC<MeetingRecorderProps> = ({ projectId, onRecordingComplete }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [timer, setTimer] = useState(0);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadingStatus, setUploadingStatus] = useState<string>('');
  
  // 復旧ダイアログ用
  const [pendingRecording, setPendingRecording] = useState<SavedRecording | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);

  // マイク(getUserMedia)はセキュアコンテキスト(HTTPS/localhost)限定。http://<LAN-IP> 等では
  // navigator.mediaDevices が無く、Chromeのサイト設定でもマイク許可がグレーアウトして変更できない。
  const [showMicHelp, setShowMicHelp] = useState(false);
  const micUnavailable = typeof window !== 'undefined'
    && (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia);
  const pageOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
    } catch { /* fallthrough to execCommand */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    } catch { /* noop */ }
  };

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const currentChunkIndexRef = useRef<number>(0);
  const isStoppingRef = useRef<boolean>(false);
  const wakeLockRef = useRef<any>(null);
  
  const meetingIdRef = useRef<number | null>(null);
  const [activeMeetingId, setActiveMeetingId] = useState<number | null>(null);

  // マウント時に未完了の録音がないかチェック
  useEffect(() => {
    const saved = localStorage.getItem('current_recording');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as SavedRecording;
        if (parsed.projectId === projectId) {
          setPendingRecording(parsed);
        }
      } catch (e) {
        console.error('Failed to parse saved recording:', e);
      }
    }
  }, [projectId]);

  // 録音タイマーの管理
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerIntervalRef.current = setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isRecording, isPaused]);

  // Wake Lock の取得
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('Wake Lock acquired successfully.');
      }
    } catch (err) {
      console.warn('Wake Lock request failed:', err);
    }
  };

  // Wake Lock の解放
  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().then(() => {
        wakeLockRef.current = null;
        console.log('Wake Lock released.');
      });
    }
  };

  // 録音の開始
  const handleStart = async () => {
    setError(null);
    // 非セキュア接続ではブラウザがマイクを許可しない。タイトル入力前に手順ダイアログを出す。
    if (micUnavailable) { setShowMicHelp(true); return; }
    const meetingTitle = window.prompt('会議のタイトルを入力してください：', `定例会議_${new Date().toLocaleDateString('ja-JP')}`);
    if (meetingTitle === null) return; // キャンセル

    const finalTitle = meetingTitle.trim() || `定例会議_${new Date().toLocaleDateString('ja-JP')}`;
    setTitle(finalTitle);

    try {
      // 1. マイクアクセスの取得
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 2. サーバー側で録音セッションを開始
      const formData = new FormData();
      formData.append('title', finalTitle);
      formData.append('date', new Date().toISOString());

      const res = await api.post(`/projects/${projectId}/meetings/record/start`, formData);
      const { meeting_id, meeting_uuid } = res.data;

      meetingIdRef.current = meeting_id;
      setActiveMeetingId(meeting_id);
      setIsRecording(true);
      setIsPaused(false);
      setIsMuted(false);
      setTimer(0);
      currentChunkIndexRef.current = 0;
      isStoppingRef.current = false;

      // 3. ローカルストレージへの保存（復旧用）
      localStorage.setItem('current_recording', JSON.stringify({
        meetingId: meeting_id,
        meetingUuid: meeting_uuid,
        projectId,
        title: finalTitle,
        startTime: Date.now()
      }));

      // 4. Wake Lock 取得
      await requestWakeLock();

      // 5. チャンク録音の開始
      startChunkRecording();

      // 6. 60秒ごとのチャンクローテーションタイマー設定
      chunkIntervalRef.current = setInterval(() => {
        rotateChunk();
      }, 60000);

    } catch (err: any) {
      console.error('Failed to start recording:', err);
      if (err.response?.status === 409) {
        setError('現在このプロジェクトで別の会議が録音中です。完了してから開始してください。');
      } else {
        setError('マイクの使用許可がないか、録音セッションの開始に失敗しました。');
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    }
  };

  // チャンク録音処理
  const startChunkRecording = () => {
    if (!streamRef.current) return;

    audioChunksRef.current = [];
    
    // ブラウザごとの適切なmimeTypeの選択
    let options = { mimeType: 'audio/webm;codecs=opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'audio/webm' };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'audio/ogg;codecs=opus' };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: '' }; // ブラウザ既定値
    }

    try {
      const recorder = new MediaRecorder(streamRef.current, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: options.mimeType || 'audio/webm' });
        const chunkIndex = currentChunkIndexRef.current;
        const currentMeetingId = meetingIdRef.current;

        if (!currentMeetingId) return;

        // 録音終了フラグが立っていない場合は、ただちに次のチャンクの録音を開始
        if (!isStoppingRef.current) {
          currentChunkIndexRef.current++;
          startChunkRecording();
        }

        // IndexedDBにバックアップ保存 (送信が完了するまで保持)
        await saveChunk(currentMeetingId, chunkIndex, blob);

        // アップロード処理
        uploadChunk(currentMeetingId, chunkIndex, blob);
      };

      // 録音開始
      recorder.start();

    } catch (e) {
      console.error('Failed to initialize MediaRecorder:', e);
      setError('録音の開始に失敗しました。お使いのブラウザが録音に対応していない可能性があります。');
    }
  };

  // チャンクのローテーション（現在の録音を止めて onstop を発火させ、即時再開）
  const rotateChunk = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  // チャンクのアップロード（失敗時は自動で裏でリトライする）
  const uploadChunk = async (mId: number, index: number, blob: Blob, attempt = 1) => {
    const formData = new FormData();
    formData.append('file', blob, `chunk_${index}.webm`);
    formData.append('chunk_index', index.toString());

    try {
      setUploadingStatus(`チャンク ${index + 1} 送信中...`);
      await api.post(`/meetings/${mId}/record/chunk`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      // 送信成功したためIndexedDBから削除
      await deleteChunk(mId, index);
      setUploadingStatus('');
    } catch (err) {
      console.warn(`Chunk ${index} upload failed (attempt ${attempt}):`, err);
      // ネットワーク切断などの場合は、10秒後にリトライ（最大10回）
      if (attempt <= 10 && isRecording) {
        setTimeout(() => {
          uploadChunk(mId, index, blob, attempt + 1);
        }, 10000);
      }
    }
  };

  // 一時停止・再開
  const handlePauseToggle = () => {
    if (!mediaRecorderRef.current) return;

    if (isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    } else {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  // ミュート・解除（音声トラックを有効/無効化する）
  const handleMuteToggle = () => {
    if (!streamRef.current) return;
    
    const audioTrack = streamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = isMuted; // 有効化フラグを設定
      setIsMuted(!isMuted);
    }
  };

  // 録音の終了
  const handleStop = async () => {
    if (!mediaRecorderRef.current || !meetingIdRef.current) return;

    if (!window.confirm('録音を終了して議事録を作成しますか？')) return;

    setIsSaving(true);
    isStoppingRef.current = true;

    // チャンクローテーション＆経過タイマーの解除（停止時は必ず両方止める）
    // ※タイマーが止まらない不具合対策: 従来は chunkInterval のみ解除し timerInterval が回り続けていた
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
      chunkIntervalRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    // 録音の停止（最終チャンクの onstop が走り、最後のアップロードが起動する）
    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // マイクストリームの停止
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // バックグラウンドでの全チャンクアップロード完了を待機して、完了リクエストを送る
    const currentMeetingId = meetingIdRef.current;
    const totalChunks = currentChunkIndexRef.current + 1;

    const checkAndComplete = setInterval(async () => {
      try {
        const unsent = await getUnsentChunks(currentMeetingId);
        if (unsent.length > 0) {
          setUploadingStatus(`残りの音声データを送信中... (残り: ${unsent.length}件)`);
          return;
        }
        clearInterval(checkAndComplete);
        setUploadingStatus('音声ファイルを結合・解析しています...');

        try {
          // 完了APIの呼び出し (force=true で結合)
          const completeData = new FormData();
          completeData.append('total_chunks', totalChunks.toString());
          completeData.append('force', 'true');
          await api.post(`/meetings/${currentMeetingId}/record/complete`, completeData);

          // 成功時のみローカルをクリーンアップ
          localStorage.removeItem('current_recording');
          await clearMeetingChunks(currentMeetingId);
          releaseWakeLock();
          setIsRecording(false);
          setIsSaving(false);
          setUploadingStatus('');
          onRecordingComplete();
        } catch (err: any) {
          // 完了APIが失敗（401=認証切れ等）。UIを必ず復帰させ、原因を明示する。
          // 録音データ(IndexedDB / current_recording)は消さず、再ログイン後に「復旧」できるようにする。
          console.error('record/complete failed:', err);
          releaseWakeLock();
          setIsRecording(false);
          setIsSaving(false);
          setUploadingStatus('');
          const st = err?.response?.status;
          setError(
            st === 401
              ? '録音の完了処理に失敗しました（ログインの有効期限が切れている可能性）。一度再ログインし、下に表示される「未送信の録音データ」から復旧してください。録音データは保存されています。'
              : '録音の完了処理に失敗しました。録音データは保存されているので、画面を再読み込みし「未送信の録音データ」から復旧してください。'
          );
        }
      } catch (e) {
        // getUnsentChunks 等の一時エラーはリトライ継続
        console.error('Error during upload check:', e);
      }
    }, 2000);
  };

  // 中断された録音の復旧（残りのチャンクをアップロードして強制完了させる）
  const handleRecover = async () => {
    if (!pendingRecording) return;
    setIsRecovering(true);
    setError(null);

    const mId = pendingRecording.meetingId;
    
    try {
      const unsent = await getUnsentChunks(mId);
      
      if (unsent.length === 0) {
        // 未送信チャンクがない場合は、推測される最大インデックスで完了を試みる
        // (完了処理はサーバー側で存在するファイルのみで結合される)
        const completeData = new FormData();
        completeData.append('total_chunks', '1000'); // 十分に大きな値
        completeData.append('force', 'true');
        await api.post(`/meetings/${mId}/record/complete`, completeData);
      } else {
        // 残っているチャンクをアップロード
        for (const item of unsent) {
          const formData = new FormData();
          formData.append('file', item.blob, `chunk_${item.index}.webm`);
          formData.append('chunk_index', item.index.toString());
          
          await api.post(`/meetings/${mId}/record/chunk`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          await deleteChunk(mId, item.index);
        }
        
        // 最大インデックスを取得して完了
        const maxIndex = Math.max(...unsent.map(u => u.index));
        const completeData = new FormData();
        completeData.append('total_chunks', (maxIndex + 1).toString());
        completeData.append('force', 'true');
        await api.post(`/meetings/${mId}/record/complete`, completeData);
      }

      // 復旧完了クリーンアップ
      localStorage.removeItem('current_recording');
      await clearMeetingChunks(mId);
      setPendingRecording(null);
      onRecordingComplete();
      alert('中断された録音データの復旧・解析依頼が完了しました。');
    } catch (err) {
      console.error('Failed to recover recording:', err);
      setError('録音データの復旧に失敗しました。サーバーに接続できないか、データが既に失われている可能性があります。');
    } finally {
      setIsRecovering(false);
    }
  };

  // 復旧データの破棄
  const handleDiscardPending = async () => {
    if (!pendingRecording) return;
    if (window.confirm('未送信の録音データを破棄しますか？この操作は取り消せません。')) {
      const mId = pendingRecording.meetingId;
      try {
        // サーバー側のレコードも削除を試みる
        await api.delete(`/projects/${projectId}/meetings/${mId}`);
      } catch (e) {
        console.warn('Failed to delete pending meeting on server:', e);
      }
      localStorage.removeItem('current_recording');
      await clearMeetingChunks(mId);
      setPendingRecording(null);
    }
  };

  // 時間フォーマット (ss -> hh:mm:ss)
  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [
      hrs.toString().padStart(2, '0'),
      mins.toString().padStart(2, '0'),
      secs.toString().padStart(2, '0')
    ].join(':');
  };

  return (
    <Box sx={{ mb: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* 非セキュア接続でマイクが使えない場合の案内バナー */}
      {micUnavailable && !isRecording && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => setShowMicHelp(true)}>
              解決方法
            </Button>
          }
        >
          このページ（{pageOrigin}）はHTTPSではないため、ブラウザがマイクを許可しません。録音するには対処が必要です。
        </Alert>
      )}

      {/* マイク有効化の手順ダイアログ（Chromeフラグによる回避策） */}
      <Dialog open={showMicHelp} onClose={() => setShowMicHelp(false)} maxWidth="sm" fullWidth>
        <DialogTitle>マイクを有効にする方法</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            ブラウザのマイク（録音）は <b>HTTPS</b> か <b>localhost</b> でしか使えません。
            現在のURLは非セキュアなため、Chromeがマイクをブロックし、サイト設定のマイク許可もグレーアウトして変更できません。
          </Typography>

          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>方法A（このPCだけで試す）</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            アドレスバーで <code>http://localhost:5175</code> を開いてください（localhost は例外的にマイクが使えます）。
          </Typography>

          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>方法B（このURLのまま使う・Chrome）</Typography>
          <Box component="ol" sx={{ pl: 3, m: 0, mb: 2, '& li': { mb: 1.5 } }}>
            <li>
              次のURLをアドレスバーに貼り付けて開く：
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Box component="code" sx={{ px: 1, py: 0.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: '0.8rem', wordBreak: 'break-all' }}>
                  chrome://flags/#unsafely-treat-insecure-origin-as-secure
                </Box>
                <Button size="small" onClick={() => copyText('chrome://flags/#unsafely-treat-insecure-origin-as-secure')}>コピー</Button>
              </Box>
            </li>
            <li>
              「Insecure origins treated as secure」のテキスト欄に次を入力：
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Box component="code" sx={{ px: 1, py: 0.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: '0.8rem', wordBreak: 'break-all' }}>
                  {pageOrigin}
                </Box>
                <Button size="small" onClick={() => copyText(pageOrigin)}>コピー</Button>
              </Box>
            </li>
            <li>右のドロップダウンを <b>Enabled</b> にして、<b>Chromeを再起動</b>。</li>
            <li>再度このページを開き、「ブラウザ録音を開始」→ マイクの使用を「許可」。</li>
          </Box>

          <Typography variant="caption" color="text.secondary">
            ※方法Bはテスト用の回避策で、デバイスごとに設定が必要です。複数端末や本番運用では HTTPS 化（ngrok 等）を推奨します。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowMicHelp(false)}>閉じる</Button>
        </DialogActions>
      </Dialog>

      {/* 復旧確認ダイアログ */}
      {pendingRecording && (
        <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'warning.main', bgcolor: 'warning.50', color: 'warning.900' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <WarningIcon color="warning" />
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
              未送信の録音データが残っています
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ mb: 2 }}>
            前回の録音（タイトル: 「{pendingRecording.title}」）が中断された可能性があります。データを復旧して議事録作成を開始しますか？
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button
              variant="contained"
              color="warning"
              size="small"
              onClick={handleRecover}
              disabled={isRecovering}
              startIcon={isRecovering ? <CircularProgress size={16} color="inherit" /> : null}
            >
              復旧して議事録作成
            </Button>
            <Button
              variant="outlined"
              color="error"
              size="small"
              onClick={handleDiscardPending}
              disabled={isRecovering}
            >
              破棄する
            </Button>
          </Box>
        </Paper>
      )}

      {/* 録音コントロールパネル */}
      {!isRecording ? (
        <Button
          variant="contained"
          color="error"
          startIcon={<MicIcon />}
          onClick={handleStart}
          disabled={!!pendingRecording}
          sx={{
            borderRadius: 2,
            px: 3,
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(244, 67, 54, 0.3)',
            bgcolor: '#F44336',
            '&:hover': {
              bgcolor: '#D32F2F',
              boxShadow: '0 6px 16px rgba(244, 67, 54, 0.4)',
            }
          }}
        >
          ブラウザ録音を開始
        </Button>
      ) : (
        <Paper
          elevation={3}
          sx={{
            p: 2.5,
            borderRadius: 3,
            borderLeft: '6px solid',
            borderColor: '#F44336',
            background: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : '#fff',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {/* 赤い点滅インジケータ */}
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  bgcolor: '#F44336',
                  animation: !isPaused ? 'pulse 1.5s infinite' : 'none',
                  '@keyframes pulse': {
                    '0%': { transform: 'scale(0.95)', boxShadow: '0 0 0 0 rgba(244, 67, 54, 0.7)' },
                    '70%': { transform: 'scale(1)', boxShadow: '0 0 0 10px rgba(244, 67, 54, 0)' },
                    '100%': { transform: 'scale(0.95)', boxShadow: '0 0 0 0 rgba(244, 67, 54, 0)' },
                  }
                }}
              />
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  {title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {isPaused ? '録音一時停止中' : isMuted ? 'ミュート中（無音録音）' : 'ミーティングを録音中...'}
                </Typography>
              </Box>
            </Box>

            {/* タイマー表示 */}
            <Typography
              variant="h4"
              sx={{
                fontFamily: 'monospace',
                fontWeight: 'bold',
                color: isPaused ? 'text.secondary' : '#F44336'
              }}
            >
              {formatTime(timer)}
            </Typography>

            {/* アクションボタン */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {/* ミュートボタン */}
              <Tooltip title={isMuted ? 'マイクをミュート解除' : 'マイクをミュート（一時的に消音）'}>
                <IconButton
                  onClick={handleMuteToggle}
                  color={isMuted ? 'error' : 'default'}
                  disabled={isSaving}
                >
                  {isMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
                </IconButton>
              </Tooltip>

              {/* 一時停止/再開 */}
              <Tooltip title={isPaused ? '録音を再開' : '録音を一時停止'}>
                <IconButton
                  onClick={handlePauseToggle}
                  color="primary"
                  disabled={isSaving}
                >
                  {isPaused ? <PlayArrowIcon /> : <PauseIcon />}
                </IconButton>
              </Tooltip>

              {/* 終了して保存 */}
              <Button
                variant="contained"
                color="error"
                startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <StopIcon />}
                onClick={handleStop}
                disabled={isSaving}
                sx={{ borderRadius: 2, ml: 1 }}
              >
                録音を終了して保存
              </Button>
            </Box>
          </Box>

          {/* アップロード中のステータス表示 */}
          {uploadingStatus && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <CircularProgress size={16} />
              <Typography variant="caption" color="text.secondary">
                {uploadingStatus}
              </Typography>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
};

export default MeetingRecorder;
