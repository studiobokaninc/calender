import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, Paper, CircularProgress, IconButton, Drawer, Button } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

interface Star {
  id: number;
  x: number;
  y: number;
  radius: number;
  color: string;
  name: string;
  project_id: number;
  pulseSpeed: number;
  pulseFactor: number;
  due_date?: string;
}

const GalaxyPage: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const starsRef = useRef<Star[]>([]);
  
  // インタラクション用のステート
  const [hoveredStar, setHoveredStar] = useState<Star | null>(null);
  const [selectedStar, setSelectedStar] = useState<Star | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // シンセサイザー音（ピーンという音）を鳴らす関数
  const playPing = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // 高めのラ
      gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.error('Failed to play sound:', e);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tasksRes, projectsRes] = await Promise.all([
          api.get('/tasks'),
          api.get('/projects')
        ]);
        
        const onlineProjectIds = new Set(
          projectsRes.data
            .filter((p: any) => (p.display_status ?? 'online') === 'online')
            .map((p: any) => p.id)
        );

        const completedTasks = tasksRes.data.filter((t: any) => {
          const isCompleted = t.status === 'completed' || t.status === 'COMPLETED';
          const isOnline = t.project_id ? onlineProjectIds.has(t.project_id) : true;
          return isCompleted && isOnline;
        });
        
        setTasks(completedTasks);
        
        const colors = ['#f093fb', '#f5576c', '#4facfe', '#00f2fe', '#ffd200', '#00ff87'];
        
        starsRef.current = completedTasks.map((t: any) => {
          const pSeedX = Math.sin(t.project_id) * 10000;
          const pSeedY = Math.cos(t.project_id) * 10000;
          const projectX = 0.25 + Math.abs(pSeedX - Math.floor(pSeedX)) * 0.5;
          const projectY = 0.25 + Math.abs(pSeedY - Math.floor(pSeedY)) * 0.5;

          const tSeedX = Math.sin(t.id) * 10000;
          const tSeedY = Math.cos(t.id) * 10000;
          const offsetRadius = 0.02 + Math.abs(tSeedX - Math.floor(tSeedX)) * 0.13;
          const offsetAngle = Math.abs(tSeedY - Math.floor(tSeedY)) * Math.PI * 2;

          const x = projectX + Math.cos(offsetAngle) * offsetRadius;
          const y = projectY + Math.sin(offsetAngle) * offsetRadius;
          
          return {
            id: t.id,
            x: x,
            y: y,
            radius: 2 + Math.random() * 3,
            color: colors[t.project_id % colors.length] || '#fff',
            name: t.name,
            project_id: t.project_id,
            pulseSpeed: 0.02 + Math.random() * 0.03,
            pulseFactor: Math.random() * Math.PI,
            due_date: t.due_date
          };
        });
      } catch (err) {
        console.error('Failed to fetch tasks for galaxy:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loading) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      setCanvasSize({ width: canvas.width, height: canvas.height });
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // マウスイベント
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      let found: Star | null = null;
      starsRef.current.forEach(s => {
        const x = s.x * canvas.width;
        const y = s.y * canvas.height;
        const dist = Math.sqrt(Math.pow(mx - x, 2) + Math.pow(my - y, 2));
        if (dist < 15) { // 当たり判定は15px
          found = s;
        }
      });
      setHoveredStar(found);
    };

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      
      starsRef.current.forEach(s => {
        const x = s.x * canvas.width;
        const y = s.y * canvas.height;
        const dist = Math.sqrt(Math.pow(mx - x, 2) + Math.pow(my - y, 2));
        if (dist < 15) {
          playPing();
          setSelectedStar(s);
        }
      });
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);

    let animationFrameId: number;

    // プロジェクトごとにグループ化（描画の最適化のため外側で計算）
    const projectGroups: { [key: number]: Star[] } = {};
    starsRef.current.forEach(s => {
      if (!projectGroups[s.project_id]) {
        projectGroups[s.project_id] = [];
      }
      projectGroups[s.project_id].push(s);
    });
    Object.values(projectGroups).forEach(group => group.sort((a, b) => a.id - b.id));

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // 背景
      const bgGradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, canvas.width
      );
      bgGradient.addColorStop(0, '#0f172a');
      bgGradient.addColorStop(1, '#020617');
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const stars = starsRef.current;

      // 1. 線を描画
      Object.values(projectGroups).forEach(group => {
        for (let i = 0; i < group.length - 1; i++) {
          const s1 = group[i];
          const s2 = group[i + 1];
          const x1 = s1.x * canvas.width;
          const y1 = s1.y * canvas.height;
          const x2 = s2.x * canvas.width;
          const y2 = s2.y * canvas.height;
          
          const dist = Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
          if (dist < canvas.width * 0.5) {
            ctx.beginPath();
            const lineGrad = ctx.createLinearGradient(x1, y1, x2, y2);
            
            // ホバー時の発光エフェクト
            const isHighlighted = hoveredStar && (hoveredStar.project_id === s1.project_id);
            const opacity = isHighlighted ? '88' : '22';
            const lineWidth = isHighlighted ? 2 : 1;
            
            lineGrad.addColorStop(0, s1.color + opacity);
            lineGrad.addColorStop(1, s2.color + opacity);
            
            ctx.strokeStyle = lineGrad;
            ctx.lineWidth = lineWidth;
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
      });

      // 2. 星を描画
      stars.forEach(star => {
        const x = star.x * canvas.width;
        const y = star.y * canvas.height;
        
        star.pulseFactor += star.pulseSpeed;
        const isHovered = hoveredStar && hoveredStar.id === star.id;
        const currentRadius = (star.radius + Math.sin(star.pulseFactor) * 1.5) * (isHovered ? 1.5 : 1);
        
        // 光彩
        const glow = ctx.createRadialGradient(x, y, 0, x, y, currentRadius * 4);
        glow.addColorStop(0, star.color);
        glow.addColorStop(1, 'transparent');
        
        ctx.beginPath();
        ctx.fillStyle = glow;
        ctx.arc(x, y, currentRadius * 4, 0, Math.PI * 2);
        ctx.fill();
        
        // 中心
        ctx.beginPath();
        ctx.fillStyle = isHovered ? '#fff' : star.color;
        ctx.arc(x, y, currentRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // テキストはホバー時のみ、または小さく表示
        if (isHovered || stars.length < 50) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.font = isHovered ? 'bold 12px Inter, sans-serif' : '10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(star.name, x, y + currentRadius + 15);
        }
      });

      animationFrameId = window.requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [loading, hoveredStar]);

  return (
    <Box sx={{ width: '100%', height: '100vh', bgcolor: '#020617', color: 'white', position: 'relative', overflow: 'hidden' }}>
      {/* ヘッダー */}
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, p: 2, zIndex: 10, display: 'flex', alignItems: 'center', background: 'linear-gradient(to bottom, rgba(2,6,23,0.8), transparent)' }}>
        <IconButton onClick={() => navigate(-1)} sx={{ color: 'white', mr: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>成果のギャラクシー</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>完了したタスクが星座として記録されます</Typography>
        </Box>
      </Box>

      {loading ? (
        <Box display="flex" justifyContent="center" alignItems="center" height="100%">
          <CircularProgress color="inherit" />
        </Box>
      ) : (
        <>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: hoveredStar ? 'pointer' : 'default' }} />
          
          {/* ホバー時のすりガラスポップアップ */}
          {hoveredStar && (
            <Paper 
              elevation={0}
              sx={{ 
                position: 'absolute', 
                left: Math.min(hoveredStar.x * canvasSize.width + 15, canvasSize.width - 220), 
                top: Math.min(hoveredStar.y * canvasSize.height + 15, canvasSize.height - 100), 
                p: 1.5, 
                bgcolor: 'rgba(15, 23, 42, 0.6)', 
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 2,
                color: 'white',
                pointerEvents: 'none', // マウスイベントを貫通させる
                zIndex: 20,
                width: 200
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{hoveredStar.name}</Typography>
              {hoveredStar.due_date && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  期日: {hoveredStar.due_date}
                </Typography>
              )}
            </Paper>
          )}

          {/* 右下の統計 */}
          <Paper 
            elevation={0}
            sx={{ 
              position: 'absolute', 
              bottom: 24, 
              right: 24, 
              p: 2, 
              bgcolor: 'rgba(15, 23, 42, 0.6)', 
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 2,
              color: 'white',
              maxWidth: 300,
              zIndex: 10
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>観測データ</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              現在、宇宙空間に {tasks.length} 個の成果の星が形成されています。
            </Typography>
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>
              星をクリックすると詳細を確認できます。
            </Typography>
          </Paper>

          {/* タスク詳細ドロワー（クリック時） */}
          <Drawer
            anchor="right"
            open={Boolean(selectedStar)}
            onClose={() => setSelectedStar(null)}
            PaperProps={{
              sx: {
                width: { xs: '100%', sm: 400 },
                bgcolor: 'rgba(15, 23, 42, 0.8)',
                backdropFilter: 'blur(20px)',
                color: 'white',
                borderLeft: '1px solid rgba(255,255,255,0.1)'
              }
            }}
          >
            {selectedStar && (
              <Box sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>タスク詳細</Typography>
                  <IconButton onClick={() => setSelectedStar(null)} sx={{ color: 'white' }}>
                    <CloseIcon />
                  </IconButton>
                </Box>
                
                <Paper sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 0.5 }}>タスク名</Typography>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>{selectedStar.name}</Typography>
                </Paper>

                <Paper sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, mb: 3 }}>
                  <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 0.5 }}>ステータス</Typography>
                  <Typography variant="body1" sx={{ color: 'success.main', fontWeight: 700 }}>完了 (Completed)</Typography>
                </Paper>

                {selectedStar.due_date && (
                  <Paper sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, mb: 3 }}>
                    <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 0.5 }}>期日</Typography>
                    <Typography variant="body1">{selectedStar.due_date}</Typography>
                  </Paper>
                )}

                <Button 
                  variant="outlined" 
                  fullWidth 
                  onClick={() => setSelectedStar(null)}
                  sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.3)', '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.05)' } }}
                >
                  閉じる
                </Button>
              </Box>
            )}
          </Drawer>
        </>
      )}
    </Box>
  );
};

export default GalaxyPage;
