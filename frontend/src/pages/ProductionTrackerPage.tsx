import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Box,
    Typography,
    Paper,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    CircularProgress,
    IconButton,
    Breadcrumbs,
    Link,
    useTheme,
    alpha,
    Stack,
    Drawer,
    Button,
    Divider,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Tabs,
    Tab,
    Tooltip,
    Grid,
} from '@mui/material';
import {
    Refresh as RefreshIcon,
    ViewModule as ViewModuleIcon,
    Close as CloseIcon,
    Add as AddIcon,
    Assignment as AssignmentIcon,
    History as HistoryIcon,
    ReportProblem as TroubleIcon,
    Person as PersonIcon,
    SwapHoriz as ChangeIcon,
    Palette as LookIcon,
    AttachFile as AssetIcon,
    LocalShipping as DeliveryIcon,
} from '@mui/icons-material';
import api, { mockDataApi, fetchProjects, fetchUsers, shotsApi, fetchAssets } from '../services/api';
import { Project, Task, User, Retake, Trouble, ChangeRequest, LookDistribution, Notification, UserMessage, Asset, Delivery } from '../types';
import { getTaskStatusColor, getTaskStatusLabel } from '../utils/taskStatus';
import { TaskQuickDetail } from '../components/TaskQuickDetail';
import { TaskEditDialog } from '../components/SearchEditDialogs';
import { useAuth } from '../contexts/AuthContext';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';

// Import sub-components
import { ShotTrackerTable } from '../components/score/ShotTrackerTable';
import { RetakesList } from '../components/score/RetakesList';
import { TroublesList } from '../components/score/TroublesList';
import { ChangeRequestsList } from '../components/score/ChangeRequestsList';
import { LookDistributionsList } from '../components/score/LookDistributionsList';
import { DeliveriesList } from '../components/score/DeliveriesList';
import { ProductionHistory } from '../components/score/ProductionHistory';
import { AssetsList } from '../components/score/AssetsList';
import { TaskLabel } from '@/components/common/TaskLabel';

interface TaskInfo {
    id: number;
    status: string;
    name: string;
    assignee: string | null;
    due_date: string | null;
}

interface ShotData {
    id: number;
    shotID: string;
    status: string;
    thumbnail_url?: string | null;
    retakes_count: number;
    troubles_count: number;
    tasks: { [type: string]: TaskInfo[] };
    cut?: string | null;
    description?: string | null;
    action?: string | null;
    dialogue?: string | null;
    bg?: string | null;
    ch?: string | null;
    prop?: string | null;
    note?: string | null;
    frame_in?: number | null;
    frame_out?: number | null;
    duration?: number | null;
    second?: number | null;
    frame_rem?: number | null;
    sl_no?: number | null;
}

interface SequenceData {
    seqID: string;
    shots: ShotData[];
}

const ProductionTrackerPage: React.FC = () => {
    const theme = useTheme();
    const { user } = useAuth();
    const [searchParams] = useSearchParams();
    const queryProjectId = searchParams.get('project');
    const [projects, setProjects] = useState<Project[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
    const [activeTab, setActiveTab] = useState(0);

    // Data states
    const [trackerData, setTrackerData] = useState<{ sequences: SequenceData[]; types: string[] } | null>(null);
    const [retakes, setRetakes] = useState<Retake[]>([]);
    const [troubles, setTroubles] = useState<Trouble[]>([]);
    const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
    const [lookDistributions, setLookDistributions] = useState<LookDistribution[]>([]);
    const [deliveries, setDeliveries] = useState<Delivery[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [userMessages, setUserMessages] = useState<UserMessage[]>([]);
    const [projectAssets, setProjectAssets] = useState<Asset[]>([]);
    const [orphanAssets, setOrphanAssets] = useState<Asset[]>([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showMyTasksOnly, setShowMyTasksOnly] = useState(false);

    // Filtered data for tracker
    const filteredTrackerData = useMemo(() => {
        if (!trackerData) return null;
        if (!showMyTasksOnly || !user) return trackerData;

        const filteredSequences = trackerData.sequences.map(seq => {
            const filteredShots = seq.shots.filter(shot => {
                return Object.values(shot.tasks).some(tasks => 
                    tasks.some(t => t.assignee === user.username || t.assignee === user.full_name)
                );
            });
            return { ...seq, shots: filteredShots };
        }).filter(seq => seq.shots.length > 0);

        return { ...trackerData, sequences: filteredSequences };
    }, [trackerData, showMyTasksOnly, user]);

    // Drawer/Dialog states
    const [isTaskDrawerOpen, setIsTaskDrawerOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [isTaskLoading, setIsTaskLoading] = useState(false);
    const [editTaskId, setEditTaskId] = useState<number | null>(null);

    const [selectedShot, setSelectedShot] = useState<ShotData | null>(null);
    const [shotDetails, setShotDetails] = useState<{
        retakes: Retake[];
        troubles: Trouble[];
        messages: UserMessage[];
    } | null>(null);
    const [shotAssets, setShotAssets] = useState<Asset[]>([]);
    const [taskAssets, setTaskAssets] = useState<Asset[]>([]);
    const [isShotDrawerOpen, setIsShotDrawerOpen] = useState(false);
    const [isShotLoading, setIsShotLoading] = useState(false);

    const [isAddShotDialogOpen, setIsAddShotDialogOpen] = useState(false);
    const [newShot, setNewShot] = useState({ seq_code: '', shot_code: '', description: '' });
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    const stats = useMemo(() => {
        const data = filteredTrackerData || trackerData;
        if (!data || !data.sequences) return null;
        let totalTasks = 0;
        let completedTasks = 0;
        let delayedTasks = 0;

        const seqStats: Record<string, { total: number, completed: number, delayed: number }> = {};
        const shotStats: Record<string, { total: number, completed: number, delayed: number }> = {};

        data.sequences.forEach(seq => {
            if (!seq || !seq.seqID) return;
            seqStats[seq.seqID] = { total: 0, completed: 0, delayed: 0 };
            seq.shots?.forEach(shot => {
                if (!shot || !shot.shotID) return;
                const shotKey = `${seq.seqID}-${shot.shotID}`;
                shotStats[shotKey] = { total: 0, completed: 0, delayed: 0 };
                
                if (shot.tasks) {
                    Object.values(shot.tasks).forEach(tasks => {
                        if (!Array.isArray(tasks)) return;
                        tasks.forEach(t => {
                            if (!t) return;
                            totalTasks++;
                            seqStats[seq.seqID].total++;
                            shotStats[shotKey].total++;
                            if (t.status === 'completed') {
                                completedTasks++;
                                seqStats[seq.seqID].completed++;
                                shotStats[shotKey].completed++;
                            }
                            if (t.status === 'delayed') {
                                delayedTasks++;
                                seqStats[seq.seqID].delayed++;
                                shotStats[shotKey].delayed++;
                            }
                        });
                    });
                }
            });
        });

        return { totalTasks, completedTasks, delayedTasks, seqStats, shotStats };
    }, [trackerData, filteredTrackerData]);

    useEffect(() => {
        const loadInitialData = async () => {
            try {
                const [projectsData, usersData] = await Promise.all([
                    fetchProjects(),
                    fetchUsers()
                ]);

                const onlineProjects = projectsData.filter((p: Project) => (p.display_status ?? 'online') === 'online');
                setProjects(onlineProjects);
                setUsers(usersData);

                // Use project query parameter if present
                const queryIdNum = queryProjectId ? parseInt(queryProjectId, 10) : null;
                const hasQueryProject = queryIdNum && onlineProjects.some((p: Project) => p.id === queryIdNum);

                if (hasQueryProject) {
                    setSelectedProjectId(queryIdNum as number);
                } else if (onlineProjects && onlineProjects.length > 0) {
                    setSelectedProjectId(onlineProjects[0].id);
                }
            } catch (err) {
                console.error('Failed to fetch initial data', err);
                setError('データの取得に失敗しました');
            }
        };
        loadInitialData();
    }, [queryProjectId]);

    useEffect(() => {
        if (selectedProjectId !== '') {
            loadTabData(selectedProjectId as number, activeTab);
        }
    }, [selectedProjectId, activeTab]);

    const loadTabData = async (projectId: number, tabIndex: number) => {
        setLoading(true);
        setError(null);
        
        // タブ切り替え時またはプロジェクト切り替え時に古いデータをクリアする（任意）
        // ここでは、データがない場合に「データが見つかりませんでした」が表示されるのを防ぐため、
        // 読み込み中は既存のデータを保持したままローダーを表示する現在の挙動を維持しつつ、
        // 明示的にnullにする場合は以下のようにします。
        // if (tabIndex === 0) setTrackerData(null);

        try {
            switch (tabIndex) {
                case 0: // ショット進捗
                    const tracker = await mockDataApi.getProductionTracker(projectId);
                    setTrackerData(tracker);
                    break;
                case 1: // リテイク
                    const retakesData = await shotsApi.getRetakes({ project_id: projectId });
                    setRetakes(retakesData);
                    break;
                case 2: // トラブル
                    const troublesData = await shotsApi.getTroubles({ project_id: projectId });
                    setTroubles(troublesData);
                    break;
                case 3: // 変更申請
                    const crData = await shotsApi.getChangeRequests({ project_id: projectId });
                    setChangeRequests(crData);
                    break;
                case 4: // ルック配信
                    const lookData = await shotsApi.getLookDistributions({ project_id: projectId });
                    setLookDistributions(lookData);
                    break;
                case 5: // 納品
                    const deliveriesData = await shotsApi.getDeliveries({ project_id: projectId });
                    setDeliveries(deliveriesData);
                    break;
                case 6: // 通知・履歴
                    const [notifs, msgs] = await Promise.all([
                        shotsApi.getNotifications({ project_id: projectId }),
                        shotsApi.getUserMessages({ project_id: projectId })
                    ]);
                    setNotifications(notifs);
                    setUserMessages(msgs);
                    break;
                case 7: // アセット一覧
                    const [allAssets, allAssetsForOrphan] = await Promise.all([
                        fetchAssets({ project_id: projectId }),
                        fetchAssets({}),
                    ]);
                    setProjectAssets(allAssets);
                    setOrphanAssets(allAssetsForOrphan.filter(a => a.shot_id === null && a.task_id === null));
                    break;

            }
        } catch (err: any) {
            console.error('Failed to fetch tab data', err);
            setError('データの取得に失敗しました');
            // エラー時はデータをクリア
            if (tabIndex === 0) setTrackerData(null);
        } finally {
            setLoading(false);
        }
    };

    const handleTaskClick = async (taskId: number) => {
        setIsTaskLoading(true);
        setTaskAssets([]);
        try {
            const [response, assets] = await Promise.all([
                api.get<Task>(`/tasks/${taskId}`),
                fetchAssets({ task_id: taskId }),
            ]);
            setSelectedTask(response.data);
            setTaskAssets(assets);
            setIsTaskDrawerOpen(true);
        } catch (err) {
            console.error('Failed to fetch task details', err);
        } finally {
            setIsTaskLoading(false);
        }
    };

    const handleShotClick = async (shot: ShotData) => {
        setSelectedShot(shot);
        setIsShotDrawerOpen(true);
        setIsShotLoading(true);
        setShotAssets([]);
        try {
            const [shotRetakes, shotTroubles, shotMessages, assets] = await Promise.all([
                shotsApi.getRetakes({ shot_id: shot.id }),
                shotsApi.getTroubles({ shot_id: shot.id }),
                shotsApi.getUserMessages({ shot_id: shot.id }),
                fetchAssets({ shot_id: shot.id }),
            ]);
            setShotDetails({
                retakes: shotRetakes,
                troubles: shotTroubles,
                messages: shotMessages
            });
            setShotAssets(assets);
        } catch (err) {
            console.error('Failed to fetch shot details', err);
        } finally {
            setIsShotLoading(false);
        }
    };

    const refreshShotAssets = async () => {
        if (!selectedShot) return;
        try {
            const assets = await fetchAssets({ shot_id: selectedShot.id });
            setShotAssets(assets);
        } catch (err) {
            console.error('Failed to refresh assets', err);
        }
    };

    const refreshTaskAssets = async () => {
        if (!selectedTask) return;
        try {
            const assets = await fetchAssets({ task_id: selectedTask.id });
            setTaskAssets(assets);
        } catch (err) {
            console.error('Failed to refresh task assets', err);
        }
    };

    const handleAddShot = async () => {
        if (!selectedProjectId) return;
        try {
            await shotsApi.createShot({
                ...newShot,
                project_id: selectedProjectId,
                status: 'planning'
            });
            setIsAddShotDialogOpen(false);
            setNewShot({ seq_code: '', shot_code: '', description: '' });
            loadTabData(selectedProjectId as number, activeTab);
        } catch (err) {
            console.error('Failed to create shot:', err);
            alert('ショットの作成に失敗しました。書式を確認してください（例: SEQ01, SHOT010）');
        }
    };

    // task_status_redesign_plan.md §6.2 の系統色とラベル定義に集約 (utils/taskStatus.ts)
    const getStatusColor = (status: string) => getTaskStatusColor(status);
    const getStatusLabel = (status: string) => getTaskStatusLabel(status);

    return (
        <Box sx={{ p: 4, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                    <Breadcrumbs sx={{ mb: 1 }}>
                        <Link color="inherit" href="/dashboard" sx={{ cursor: 'pointer' }}>Dashboard</Link>
                        <Typography color="text.primary">Production Tracker</Typography>
                    </Breadcrumbs>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <ViewModuleIcon sx={{ fontSize: '2rem', color: '#2196F3' }} />
                        <Typography variant="h4" sx={{ fontWeight: 800, background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                            Production Tracker
                        </Typography>
                    </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setIsAddShotDialogOpen(true)}
                        sx={{ borderRadius: 2, px: 3, fontWeight: 700 }}
                    >
                        ショット追加
                    </Button>
                    <FormControl variant="outlined" size="medium" sx={{ minWidth: 250 }}>
                        <InputLabel>プロジェクト選択</InputLabel>
                        <Select
                            value={selectedProjectId}
                            onChange={(e) => setSelectedProjectId(e.target.value as number)}
                            label="プロジェクト選択"
                            sx={{ borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.8) }}
                        >
                            {projects.map((p) => (
                                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <IconButton onClick={() => selectedProjectId && loadTabData(selectedProjectId as number, activeTab)} color="primary">
                        <RefreshIcon />
                    </IconButton>
                </Box>
            </Box>

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs 
                    value={activeTab} 
                    onChange={(_, val) => setActiveTab(val)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{
                        '& .MuiTab-root': { fontWeight: 700, fontSize: '0.95rem', minHeight: 60 },
                        '& .Mui-selected': { color: theme.palette.primary.main }
                    }}
                >
                    <Tab label="ショット進捗" icon={<ViewModuleIcon />} iconPosition="start" />
                    <Tab label="リテイク" icon={<HistoryIcon />} iconPosition="start" />
                    <Tab label="トラブル" icon={<TroubleIcon />} iconPosition="start" />
                    <Tab label="変更申請" icon={<ChangeIcon />} iconPosition="start" />
                    <Tab label="ルック配信" icon={<LookIcon />} iconPosition="start" />
                    <Tab label="納品" icon={<DeliveryIcon />} iconPosition="start" />
                    <Tab label="通知・履歴" icon={<RefreshIcon />} iconPosition="start" />
                    <Tab label="アセット一覧" icon={<AssetIcon />} iconPosition="start" />
                </Tabs>
            </Box>

            <Box sx={{ flexGrow: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                {activeTab === 0 && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="h6" sx={{ fontWeight: 800 }}>ショット・シーケンス進捗管理</Typography>
                            <ToggleButtonGroup
                                size="small"
                                value={showMyTasksOnly}
                                exclusive
                                onChange={(_, value) => value !== null && setShowMyTasksOnly(value)}
                            >
                                <ToggleButton value={false} sx={{ textTransform: 'none', px: 2 }}>すべて表示</ToggleButton>
                                <ToggleButton value={true} sx={{ textTransform: 'none', px: 2, display: 'flex', gap: 1 }}>
                                    <PersonIcon fontSize="small" /> 自分のタスクのみ
                                </ToggleButton>
                            </ToggleButtonGroup>
                        </Box>
                        <ShotTrackerTable
                            data={filteredTrackerData}
                            loading={loading}
                            error={error}
                            user={user as any}
                            stats={stats}
                            onTaskClick={handleTaskClick}
                            onShotClick={handleShotClick}
                        />
                    </Box>
                )}

                {activeTab === 1 && <RetakesList retakes={retakes} loading={loading} />}
                {activeTab === 2 && <TroublesList troubles={troubles} loading={loading} />}
                {activeTab === 3 && <ChangeRequestsList requests={changeRequests} loading={loading} />}
                {activeTab === 4 && <LookDistributionsList distributions={lookDistributions} loading={loading} />}
                {activeTab === 5 && <DeliveriesList deliveries={deliveries} loading={loading} />}
                {activeTab === 6 && <ProductionHistory notifications={notifications} messages={userMessages} loading={loading} users={users} />}
                {activeTab === 7 && (
                    <Box>
                        <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
                            プロジェクト全体アセット ({projectAssets.length})
                        </Typography>
                        <AssetsList
                            assets={projectAssets}
                            onDeleted={() => selectedProjectId && loadTabData(selectedProjectId as number, 7)}
                            users={users}
                        />
                        {orphanAssets.length > 0 && (
                            <Box sx={{ mt: 4 }}>
                                <Typography variant="h6" sx={{ fontWeight: 800, mb: 1, color: 'warning.main' }}>
                                    未紐付けアセット ({orphanAssets.length})
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                    shot_id / task_id いずれも未設定のアセット。通常は発生しませんが、異常検出のため表示しています。
                                </Typography>
                                <AssetsList
                                    assets={orphanAssets}
                                    onDeleted={() => selectedProjectId && loadTabData(selectedProjectId as number, 7)}
                                    users={users}
                                />
                            </Box>
                        )}
                    </Box>
                )}
            </Box>

            {/* ショット詳細ドロワー */}
            <Drawer
                anchor="right"
                open={isShotDrawerOpen}
                onClose={() => setIsShotDrawerOpen(false)}
                PaperProps={{ sx: { width: { xs: '100%', sm: 600 } } }}
            >
                <Box sx={{ p: 3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                        <Typography variant="h5" sx={{ fontWeight: 800 }}>ショット詳細: {selectedShot?.shotID}</Typography>
                        <IconButton onClick={() => setIsShotDrawerOpen(false)}><CloseIcon /></IconButton>
                    </Box>
                    
                    {selectedShot && (
                        <Stack spacing={4}>
                            <Paper sx={{ p: 2.5, bgcolor: alpha(theme.palette.primary.main, 0.03), border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
                                <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 800, mb: 2, fontSize: '0.9rem' }}>基本情報</Typography>
                                <Grid container spacing={2}>
                                    <Grid item xs={6} sm={4}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>ステータス</Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{selectedShot.status}</Typography>
                                    </Grid>
                                    <Grid item xs={6} sm={4}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>No. (順序)</Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{selectedShot.sl_no ?? '—'}</Typography>
                                    </Grid>
                                    <Grid item xs={6} sm={4}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>カット</Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{selectedShot.cut ?? '—'}</Typography>
                                    </Grid>
                                    <Grid item xs={6} sm={4}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>フレームイン</Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{selectedShot.frame_in ?? '—'}</Typography>
                                    </Grid>
                                    <Grid item xs={6} sm={4}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>フレームアウト</Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{selectedShot.frame_out ?? '—'}</Typography>
                                    </Grid>
                                    <Grid item xs={6} sm={4}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>デュレーション</Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{selectedShot.duration ?? '—'}</Typography>
                                    </Grid>
                                    <Grid item xs={6} sm={4}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>秒数</Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{selectedShot.second != null ? `${selectedShot.second}s` : '—'}</Typography>
                                    </Grid>
                                    <Grid item xs={6} sm={4}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>余りフレーム</Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{selectedShot.frame_rem ?? '—'}</Typography>
                                    </Grid>
                                    <Grid item xs={6} sm={4}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>BG / CH / PROP</Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                            {selectedShot.bg || '—'} / {selectedShot.ch || '—'} / {selectedShot.prop || '—'}
                                        </Typography>
                                    </Grid>
                                </Grid>
                            </Paper>

                            {/* 説明・アクション・セリフ */}
                            {(selectedShot.description || selectedShot.action || selectedShot.dialogue || selectedShot.note) && (
                                <Paper sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
                                    <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 800, mb: 2, fontSize: '0.9rem' }}>ショット詳細メタデータ</Typography>
                                    <Stack spacing={2}>
                                        {selectedShot.description && (
                                            <Box>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>説明</Typography>
                                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.5 }}>{selectedShot.description}</Typography>
                                            </Box>
                                        )}
                                        {selectedShot.action && (
                                            <Box>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>アクション</Typography>
                                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.5 }}>{selectedShot.action}</Typography>
                                            </Box>
                                        )}
                                        {selectedShot.dialogue && (
                                            <Box>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>セリフ</Typography>
                                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.5 }}>{selectedShot.dialogue}</Typography>
                                            </Box>
                                        )}
                                        {selectedShot.note && (
                                            <Box>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>ノート / 備考</Typography>
                                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.5, color: 'warning.main' }}>{selectedShot.note}</Typography>
                                            </Box>
                                        )}
                                    </Stack>
                                </Paper>
                            )}

                            {selectedShot.thumbnail_url && (
                                <Box>
                                    <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 700, mb: 1 }}>サムネイル</Typography>
                                    <Tooltip title="クリックで拡大" placement="top">
                                        <Box
                                            component="img"
                                            src={selectedShot.thumbnail_url}
                                            alt="サムネイル"
                                            onClick={() => setLightboxUrl(selectedShot.thumbnail_url!)}
                                            sx={{
                                                width: '100%',
                                                height: 'auto',
                                                maxHeight: 200,
                                                objectFit: 'contain',
                                                borderRadius: 2,
                                                cursor: 'zoom-in',
                                                border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
                                                display: 'block',
                                            }}
                                        />
                                    </Tooltip>
                                </Box>
                            )}

                            <Box>
                                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <AssignmentIcon color="action" /> タスク状況
                                </Typography>
                                {Object.entries(selectedShot.tasks).map(([type, tasks]) => (
                                    <Box key={type} sx={{ mb: 2 }}>
                                        <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase' }}>{type}</Typography>
                                        <Stack spacing={1} sx={{ mt: 0.5 }}>
                                            {tasks.map(t => (
                                                <Paper key={t.id} variant="outlined" sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 1.5 }}>
                                                    <Box>
                                                        <TaskLabel shotId={selectedShot.shotID} title={t.name} fontSize="0.875rem" />
                                                        <Typography variant="caption" color="text.secondary">{t.assignee || '未アサイン'}</Typography>
                                                    </Box>
                                                    <Typography variant="caption" sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: getStatusColor(t.status), color: 'white', fontWeight: 800 }}>
                                                        {getStatusLabel(t.status)}
                                                    </Typography>
                                                </Paper>
                                            ))}
                                        </Stack>
                                    </Box>
                                ))}
                            </Box>

                            <Divider />

                            {isShotLoading ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
                            ) : (
                                <>
                                    <Box>
                                        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <HistoryIcon color="error" /> リテイク状況 ({shotDetails?.retakes.length || 0})
                                        </Typography>
                                        <RetakesList retakes={shotDetails?.retakes || []} compact={true} />
                                    </Box>


                                    <Box>
                                        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <TroubleIcon color="warning" /> トラブル報告 ({shotDetails?.troubles.length || 0})
                                        </Typography>
                                        <TroublesList troubles={shotDetails?.troubles || []} compact={true} />
                                    </Box>


                                    <Box>
                                        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <RefreshIcon color="primary" /> ショット内メッセージ ({shotDetails?.messages.length || 0})
                                        </Typography>
                                        <ProductionHistory notifications={[]} messages={shotDetails?.messages || []} users={users} />
                                    </Box>

                                    <Box>
                                        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                            アセット ({shotAssets.length})
                                        </Typography>
                                        <AssetsList
                                            assets={shotAssets}
                                            compact={true}
                                            onDeleted={refreshShotAssets}
                                            users={users}
                                        />
                                    </Box>
                                </>
                            )}
                        </Stack>
                    )}
                </Box>
            </Drawer>

            {/* タスク詳細ドロワー */}
            <Drawer
                anchor="right"
                open={isTaskDrawerOpen}
                onClose={() => setIsTaskDrawerOpen(false)}
                PaperProps={{
                    sx: { width: { xs: '100%', sm: 400 }, maxWidth: '100%', zIndex: 1400 }
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>タスク詳細</Typography>
                    <IconButton onClick={() => setIsTaskDrawerOpen(false)}>
                        <CloseIcon />
                    </IconButton>
                </Box>
                {selectedTask ? (
                    <>
                        <TaskQuickDetail
                            task={selectedTask}
                            projects={projects}
                            users={users}
                            onUpdate={async (taskId, updates) => {
                                await api.put(`/tasks/${taskId}`, updates);
                                if (selectedProjectId) loadTabData(selectedProjectId as number, activeTab);
                            }}
                            onEditFull={(task) => {
                                setEditTaskId(task.id);
                                setIsTaskDrawerOpen(false);
                            }}
                        />
                        <Box sx={{ px: 2, pb: 3, mt: 2 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                アセット ({taskAssets.length})
                            </Typography>
                            <AssetsList
                                assets={taskAssets}
                                compact={true}
                                onDeleted={refreshTaskAssets}
                                users={users}
                            />
                        </Box>
                    </>
                ) : (
                    isTaskLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
                            <CircularProgress />
                        </Box>
                    )
                )}
            </Drawer>

            {/* ショット追加ダイアログ */}
            <Dialog open={isAddShotDialogOpen} onClose={() => setIsAddShotDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
                <DialogTitle sx={{ fontWeight: 800 }}>新規ショット追加</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label="シーケンスコード (例: SEQ01)"
                            fullWidth
                            value={newShot.seq_code}
                            onChange={(e) => setNewShot({ ...newShot, seq_code: e.target.value.toUpperCase() })}
                            placeholder="SEQ01"
                        />
                        <TextField
                            label="ショットコード (例: SHOT010)"
                            fullWidth
                            value={newShot.shot_code}
                            onChange={(e) => setNewShot({ ...newShot, shot_code: e.target.value.toUpperCase() })}
                            placeholder="SHOT010"
                        />
                        <TextField
                            label="説明"
                            fullWidth
                            multiline
                            rows={3}
                            value={newShot.description}
                            onChange={(e) => setNewShot({ ...newShot, description: e.target.value })}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ p: 3 }}>
                    <Button onClick={() => setIsAddShotDialogOpen(false)} color="inherit">キャンセル</Button>
                    <Button onClick={handleAddShot} variant="contained" disabled={!newShot.seq_code || !newShot.shot_code}>作成</Button>
                </DialogActions>
            </Dialog>

            {/* 詳細編集用ダイアログ */}
            <TaskEditDialog
                open={editTaskId !== null}
                taskId={editTaskId}
                onClose={() => setEditTaskId(null)}
                onSaved={() => {
                    setEditTaskId(null);
                    if (selectedProjectId) loadTabData(selectedProjectId as number, activeTab);
                }}
            />

            {/* サムネイル拡大表示 */}
            <Dialog
                open={!!lightboxUrl}
                onClose={() => setLightboxUrl(null)}
                maxWidth="lg"
                fullWidth
                PaperProps={{ sx: { bgcolor: theme.palette.grey[900], m: 1 } }}
            >
                <DialogContent sx={{ p: 0, position: 'relative' }}>
                    <IconButton
                        onClick={() => setLightboxUrl(null)}
                        sx={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            color: 'white',
                            bgcolor: alpha(theme.palette.common.black, 0.5),
                            zIndex: 1,
                            '&:hover': { bgcolor: alpha(theme.palette.common.black, 0.7) },
                        }}
                    >
                        <CloseIcon />
                    </IconButton>
                    {lightboxUrl && (
                        <Box
                            component="img"
                            src={lightboxUrl}
                            alt="サムネイル拡大"
                            sx={{
                                width: '100%',
                                height: 'auto',
                                maxHeight: '90vh',
                                objectFit: 'contain',
                                display: 'block',
                            }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </Box>
    );
};

export default ProductionTrackerPage;
