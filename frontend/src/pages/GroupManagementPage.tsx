import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, CircularProgress, Paper, List, ListItem, ListItemButton,
  Divider, Button, IconButton, TextField, Dialog,
  DialogActions, DialogContent, DialogTitle, Select, MenuItem, FormControl,
  InputLabel, Tooltip, Stack, Snackbar, Alert, Card, CardContent, InputAdornment,
  Chip, useTheme, useMediaQuery,
  Breadcrumbs, Link
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import GroupIcon from '@mui/icons-material/Group';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import api from '../services/api';
import { Group, User, UserGroup } from '../types';
import { format, parseISO, isValid } from 'date-fns';
import { ja } from 'date-fns/locale';

const GroupManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<UserGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupStartDate, setNewGroupStartDate] = useState('');
  const [newGroupEndDate, setNewGroupEndDate] = useState('');
  const [newGroupUsers, setNewGroupUsers] = useState<string[]>([]);
  const [newGroupSelectOpen, setNewGroupSelectOpen] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [usersToAdd, setUsersToAdd] = useState<string[]>([]);
  const [addUserSelectOpen, setAddUserSelectOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupDesc, setEditGroupDesc] = useState('');
  const [editGroupStartDate, setEditGroupStartDate] = useState('');
  const [editGroupEndDate, setEditGroupEndDate] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [isCreateMeetingModalOpen, setIsCreateMeetingModalOpen] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingStartTime, setMeetingStartTime] = useState('10:00');
  const [meetingEndTime, setMeetingEndTime] = useState('11:00');
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingSaving, setMeetingSaving] = useState(false);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({ open: false, message: '', severity: 'info' });
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; onConfirm: () => void }>({ open: false, message: '', onConfirm: () => {} });
  const openConfirmDialog = (message: string, onConfirm: () => void) => setConfirmDialog({ open: true, message, onConfirm });
  const closeConfirmDialog = () => setConfirmDialog(d => ({ ...d, open: false }));

  // 日付フォーマット用のヘルパー関数
  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return '';
    try {
      const date = parseISO(dateString);
      if (isValid(date)) {
        return format(date, 'yyyy年M月d日', { locale: ja });
      }
    } catch (e) {
      console.error('Date formatting error:', e);
    }
    return '';
  };

  // 日付範囲の表示用ヘルパー関数
  const formatDateRange = (startDate: string | null | undefined, endDate: string | null | undefined): string => {
    const start = formatDate(startDate);
    const end = formatDate(endDate);
    if (start && end) {
      return `${start} 〜 ${end}`;
    } else if (start) {
      return `${start} 〜`;
    } else if (end) {
      return `〜 ${end}`;
    }
    return '未設定';
  };

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [groupsRes, usersRes] = await Promise.all([
        api.get<Group[]>('/api/groups'),
        api.get<User[]>('/api/users'),
      ]);
      setGroups(groupsRes.data);
      setUsers(usersRes.data);
      if (!selectedGroup && groupsRes.data.length > 0) {
        setSelectedGroup(groupsRes.data[0]);
      }
    } catch (err) {
      console.error("Failed to fetch initial group data:", err);
      setError('グループまたはユーザーデータの取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  useEffect(() => {
    const fetchGroupMembers = async () => {
      if (!selectedGroup) {
        setSelectedGroupMembers([]);
        return;
      }
      setLoadingMembers(true);
      setMembersError(null);
      try {
        const response = await api.get<UserGroup[]>(`/api/user_groups?group_id=${selectedGroup.id}`);
        setSelectedGroupMembers(response.data);
      } catch (err) {
        console.error(`Failed to fetch members for group ${selectedGroup.id}:`, err);
        setMembersError('グループメンバーの取得に失敗しました。');
        setSelectedGroupMembers([]);
      } finally {
        setLoadingMembers(false);
      }
    };
    fetchGroupMembers();
  }, [selectedGroup]);

  const userMap = useMemo(() => new Map(users.map(u => [u.id, u.name || u.email])), [users]);

  const usersInSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    const memberUserIds = new Set(selectedGroupMembers.map(ug => ug.user_id));
    return users.filter(u => memberUserIds.has(u.id));
  }, [selectedGroup, selectedGroupMembers, users]);

  const usersNotInSelectedGroup = useMemo(() => {
    if (!selectedGroup) return [];
    const memberUserIds = new Set(selectedGroupMembers.map(ug => ug.user_id));
    return users.filter(u => !memberUserIds.has(u.id));
  }, [selectedGroup, selectedGroupMembers, users]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.trim().toLowerCase();
    return groups.filter(g =>
      (g.name || '').toLowerCase().includes(q) ||
      (g.description || '').toLowerCase().includes(q)
    );
  }, [groups, searchQuery]);

  const handleGroupSelect = (group: Group) => setSelectedGroup(group);

  const handleOpenCreateModal = () => {
    setNewGroupName('');
    setNewGroupDesc('');
    setNewGroupStartDate('');
    setNewGroupEndDate('');
    setNewGroupUsers([]);
    setIsCreateModalOpen(true);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      const response = await api.post<Group>('/api/groups', {
        name: newGroupName.trim(),
        description: newGroupDesc.trim() || undefined,
        start_date: newGroupStartDate || undefined,
        end_date: newGroupEndDate || undefined,
      });
      const newGroup = response.data;

      // 選択されたユーザーをグループに追加
      if (newGroupUsers.length > 0) {
        const results = await Promise.allSettled(
          newGroupUsers.map(userId => api.post('/api/user_groups', { user_id: Number(userId), group_id: newGroup.id }))
        );
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
          console.error(`${failed.length}件のメンバー追加に失敗しました`);
        }
      }

      await fetchInitialData();
      handleCloseCreateModal();
      const userMessage = newGroupUsers.length > 0
        ? `グループ「${newGroupName}」を作成し、${newGroupUsers.length}人のメンバーを追加しました`
        : `グループ「${newGroupName}」を作成しました`;
      setSnackbar({ open: true, message: userMessage, severity: 'success' });
    } catch (err) {
      console.error("Failed to create group:", err);
      setSnackbar({ open: true, message: 'グループの作成に失敗しました', severity: 'error' });
    }
  };

  const handleCloseCreateModal = () => {
    setIsCreateModalOpen(false);
    setNewGroupName('');
    setNewGroupDesc('');
    setNewGroupStartDate('');
    setNewGroupEndDate('');
    setNewGroupUsers([]);
  };

  const handleOpenEditModal = () => {
    if (!selectedGroup) return;
    setEditGroupName(selectedGroup.name || '');
    setEditGroupDesc(selectedGroup.description || '');
    setEditGroupStartDate(selectedGroup.start_date ? selectedGroup.start_date.split('T')[0] : '');
    setEditGroupEndDate(selectedGroup.end_date ? selectedGroup.end_date.split('T')[0] : '');
    setIsEditModalOpen(true);
  };

  const handleSaveEditGroup = async () => {
    if (!selectedGroup) return;
    setEditSaving(true);
    try {
      await api.put(`/api/groups/${selectedGroup.id}`, {
        name: editGroupName.trim(),
        description: editGroupDesc.trim() || undefined,
        start_date: editGroupStartDate || undefined,
        end_date: editGroupEndDate || undefined,
      });
      setGroups(prev => prev.map(g => g.id === selectedGroup.id ? {
        ...g,
        name: editGroupName.trim(),
        description: editGroupDesc.trim() || undefined,
        start_date: editGroupStartDate || undefined,
        end_date: editGroupEndDate || undefined,
      } : g));
      setSelectedGroup(prev => prev && prev.id === selectedGroup.id ? {
        ...prev,
        name: editGroupName.trim(),
        description: editGroupDesc.trim() || undefined,
        start_date: editGroupStartDate || undefined,
        end_date: editGroupEndDate || undefined,
      } : prev);
      setIsEditModalOpen(false);
      setSnackbar({ open: true, message: 'グループを更新しました', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: 'グループの更新に失敗しました', severity: 'error' });
    } finally {
      setEditSaving(false);
    }
  };

  const handleCloseEditModal = () => setIsEditModalOpen(false);

  const handleOpenAddUserModal = () => setIsAddUserModalOpen(true);
  const handleCloseAddUserModal = () => {
    setIsAddUserModalOpen(false);
    setUsersToAdd([]);
  };

  const handleAddUserToGroup = async () => {
    if (!selectedGroup || usersToAdd.length === 0) return;
    try {
      const results = await Promise.allSettled(
        usersToAdd.map(userId => api.post('/api/user_groups', { user_id: Number(userId), group_id: selectedGroup.id }))
      );
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        console.error(`${failed.length}件の追加に失敗しました`);
      }
      const res = await api.get<UserGroup[]>(`/api/user_groups?group_id=${selectedGroup.id}`);
      setSelectedGroupMembers(res.data);
      handleCloseAddUserModal();
      const succeeded = results.length - failed.length;
      setSnackbar({
        open: true,
        message: succeeded === 1 ? 'メンバーを追加しました' : `${succeeded}人を追加しました`,
        severity: failed.length > 0 ? 'warning' : 'success',
      });
    } catch (err) {
      console.error("Failed to add user to group:", err);
      setSnackbar({ open: true, message: 'ユーザーの追加に失敗しました', severity: 'error' });
    }
  };

  const handleRemoveUser = (userId: number) => {
    if (!selectedGroup) return;
    const name = userMap.get(userId) || `ID ${userId}`;
    openConfirmDialog(
      `${name} をグループ「${selectedGroup.name}」から外しますか？`,
      async () => {
        closeConfirmDialog();
        try {
          await api.delete(`/api/user_groups/${String(userId)}/${String(selectedGroup.id)}`);
          setSelectedGroupMembers(prev => prev.filter(ug => ug.user_id !== userId));
          setSnackbar({ open: true, message: 'メンバーをグループから外しました', severity: 'success' });
        } catch (err) {
          setSnackbar({ open: true, message: 'グループから外すのに失敗しました', severity: 'error' });
        }
      }
    );
  };

  const handleDeleteGroup = () => {
    if (!selectedGroup) return;
    openConfirmDialog(
      `グループ「${selectedGroup.name}」を削除してもよろしいですか？関連するメンバー割り当ても解除されます。`,
      async () => {
        closeConfirmDialog();
        try {
          await api.delete(`/api/groups/${selectedGroup.id}`);
          setSnackbar({ open: true, message: 'グループを削除しました', severity: 'success' });
          setSelectedGroup(null);
          await fetchInitialData();
        } catch (err: unknown) {
          const errMsg = err && typeof err === 'object' && 'response' in err && err.response && typeof (err.response as { data?: { detail?: string } }).data?.detail === 'string'
            ? (err.response as { data: { detail: string } }).data.detail
            : '不明なエラー';
          setSnackbar({ open: true, message: `削除に失敗しました: ${errMsg}`, severity: 'error' });
        }
      }
    );
  };

  const handleCloseSnackbar = (_?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    setSnackbar(s => ({ ...s, open: false }));
  };

  const handleOpenCreateMeetingModal = () => {
    if (!selectedGroup) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    setMeetingTitle(`${selectedGroup.name} 会議`);
    setMeetingDate(today);
    setMeetingStartTime('10:00');
    setMeetingEndTime('11:00');
    setMeetingLocation('');
    setIsCreateMeetingModalOpen(true);
  };

  const handleCloseCreateMeetingModal = () => {
    setIsCreateMeetingModalOpen(false);
    setMeetingTitle('');
    setMeetingDate('');
    setMeetingStartTime('');
    setMeetingEndTime('');
    setMeetingLocation('');
  };

  const handleCreateMeeting = async () => {
    if (!selectedGroup || usersInSelectedGroup.length === 0) return;
    const title = meetingTitle.trim() || `${selectedGroup.name} 会議`;
    if (!meetingDate || !meetingStartTime || !meetingEndTime) {
      setSnackbar({ open: true, message: '日付・開始時刻・終了時刻を入力してください', severity: 'warning' });
      return;
    }
    setMeetingSaving(true);
    try {
      const startTimeStr = `${meetingDate}T${meetingStartTime}:00+09:00`;
      const endTimeStr = `${meetingDate}T${meetingEndTime}:00+09:00`;
      const participants = usersInSelectedGroup.map(u => ({ type: 'user' as const, id: u.id }));
      await api.post('/calendar/events', {
        title,
        type: 'Meeting',
        start_time: startTimeStr,
        end_time: endTimeStr,
        location: meetingLocation.trim() || null,
        participants,
      });
      handleCloseCreateMeetingModal();
      setSnackbar({ open: true, message: '会議を作成しました', severity: 'success' });
    } catch (err) {
      console.error('Failed to create meeting:', err);
      setSnackbar({ open: true, message: '会議の作成に失敗しました', severity: 'error' });
    } finally {
      setMeetingSaving(false);
    }
  };

  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  if (loading && groups.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 120px)' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography color="error">{error}</Typography>
        <Button startIcon={<RefreshIcon />} onClick={fetchInitialData} sx={{ mt: 2 }}>再読み込み</Button>
      </Paper>
    );
  }

  return (
    <Box sx={{ height: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column', p: { xs: 1.5, sm: 3 } }}>
      <Box sx={{ mb: 4 }}>
        <Breadcrumbs sx={{ mb: 1.5 }}>
          <Link color="inherit" onClick={() => navigate('/dashboard')} sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
            App
          </Link>
          <Typography color="text.primary" sx={{ fontWeight: 500 }}>Groups</Typography>
        </Breadcrumbs>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <GroupIcon sx={{ fontSize: '2rem', color: '#00BCD4' }} />
          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              background: 'linear-gradient(45deg, #00BCD4 30%, #3F51B5 90%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontSize: { xs: '1.75rem', sm: '2.25rem' }
            }}
          >
            Group Management
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.95rem' }}>
          チーム構成、部署、プロジェクトグループの編成とメンバー管理を行います。
        </Typography>
      </Box>
      <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden', flexDirection: 'row', gap: 2 }}>
        {/* 左: グループ一覧 */}
        {(!isMobile || !selectedGroup) && (
          <Paper
            elevation={0}
            sx={{
              width: isMobile ? '100%' : 280,
              flexShrink: 0,
              borderRight: isMobile ? 0 : 1,
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 0,
              height: '100%',
            }}
          >
            <Box sx={{ p: 2, pb: 1 }}>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5 }}>グループ</Typography>
              <TextField
                size="small"
                placeholder="検索..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ mb: 1 }}
              />
              <Button
                variant="contained"
                size="small"
                fullWidth
                startIcon={<AddIcon />}
                onClick={handleOpenCreateModal}
              >
                新規作成
              </Button>
            </Box>
            <Divider />
            <List sx={{ overflowY: 'auto', flexGrow: 1, py: 0 }}>
              {filteredGroups.length === 0 ? (
                <ListItem>
                  <Typography variant="body2" color="text.secondary">
                    {searchQuery ? '該当するグループがありません' : 'グループがまだありません'}
                  </Typography>
                </ListItem>
              ) : (
                filteredGroups.map((group) => {
                  const isSelected = selectedGroup?.id === group.id;
                  return (
                    <ListItem key={group.id} disablePadding>
                      <ListItemButton
                        selected={isSelected}
                        onClick={() => handleGroupSelect(group)}
                        sx={{
                          py: 1.5,
                          borderRadius: 1,
                          mx: 0.5,
                          mb: 0.5,
                          border: isSelected ? 2 : 1,
                          borderColor: isSelected ? 'primary.main' : 'divider',
                          bgcolor: isSelected ? 'primary.50' : 'background.paper',
                          '&:hover': {
                            bgcolor: isSelected ? 'primary.100' : 'action.hover',
                            borderColor: 'primary.main',
                          },
                          transition: 'all 0.2s ease-in-out',
                        }}
                      >
                        <Box sx={{ width: '100%' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography
                              variant="subtitle1"
                              fontWeight={isSelected ? 700 : 600}
                              color={isSelected ? 'primary.main' : 'text.primary'}
                            >
                              {group.name}
                            </Typography>
                          </Box>
                          {group.description && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {group.description}
                            </Typography>
                          )}
                        </Box>
                      </ListItemButton>
                    </ListItem>
                  );
                })
              )}
            </List>
          </Paper>
        )}

        {/* 右: 選択グループの詳細 */}
        {(!isMobile || selectedGroup) && (
          <Box
            sx={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              bgcolor: isDarkMode ? 'background.default' : 'grey.50',
              width: isMobile ? '100%' : 'auto',
            }}
          >
            {isMobile && selectedGroup && (
              <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', alignItems: 'center' }}>
                <Button onClick={() => setSelectedGroup(null)} startIcon={<NavigateBeforeIcon />}>
                  戻る
                </Button>
              </Box>
            )}
            {selectedGroup ? (
              <Card sx={{ m: 2, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 2 }}>
                <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', pb: 2 }}>
                  <Box
                    sx={{
                      p: 2,
                      mb: 2,
                      borderRadius: 2,
                      bgcolor: 'primary.50',
                      border: 2,
                      borderColor: 'primary.light',
                      boxShadow: 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <GroupIcon sx={{ fontSize: 28, color: 'primary.main' }} />
                          <Typography variant="h4" fontWeight={700} color="primary.main">
                            {selectedGroup.name}
                          </Typography>
                        </Box>
                      </Box>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        <Tooltip title="編集">
                          <IconButton
                            size="small"
                            onClick={handleOpenEditModal}
                            color="primary"
                            sx={{
                              bgcolor: 'background.paper',
                              '&:hover': { bgcolor: 'primary.light', color: 'white' }
                            }}
                          >
                            <EditIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={usersNotInSelectedGroup.length === 0 ? "全員このグループに所属しています" : ""}>
                          <span>
                            <Button
                              variant="contained"
                              size="small"
                              startIcon={<PersonAddIcon />}
                              onClick={handleOpenAddUserModal}
                              disabled={usersNotInSelectedGroup.length === 0}
                            >
                              メンバー追加
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip title={usersInSelectedGroup.length === 0 ? 'メンバーを追加してから会議を作成できます' : 'グループのメンバーを参加者とする会議を作成'}>
                          <span>
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<MeetingRoomIcon />}
                              onClick={handleOpenCreateMeetingModal}
                              disabled={usersInSelectedGroup.length === 0}
                            >
                              会議を作成
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip title="グループを削除">
                          <IconButton
                            size="small"
                            onClick={handleDeleteGroup}
                            color="error"
                            sx={{
                              bgcolor: 'background.paper',
                              '&:hover': { bgcolor: 'error.light', color: 'white' }
                            }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Box>
                  </Box>
                  {/* グループ情報サマリー */}
                  <Box
                    sx={{
                      mb: 2,
                      p: 2,
                      bgcolor: 'background.paper',
                      borderRadius: 2,
                      border: 2,
                      borderColor: 'primary.light',
                      boxShadow: 2,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Box sx={{
                        width: 4,
                        height: 24,
                        bgcolor: 'primary.main',
                        borderRadius: 1
                      }} />
                      <Typography variant="h6" color="primary.main" sx={{ fontWeight: 700 }}>
                        グループ情報
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {/* 説明 */}
                      <Box sx={(theme) => ({
                        p: 1.5,
                        bgcolor: theme.palette.mode === 'dark' ? 'background.default' : 'grey.50',
                        borderRadius: 1,
                        border: 1,
                        borderColor: 'divider',
                      })}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            説明
                          </Typography>
                        </Box>
                        {selectedGroup.description ? (
                          <Typography variant="body2" color="text.primary" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                            {selectedGroup.description}
                          </Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                            説明が設定されていません
                          </Typography>
                        )}
                      </Box>

                      {/* 期間情報 */}
                      <Box sx={(theme) => ({
                        p: 1.5,
                        bgcolor: theme.palette.mode === 'dark' ? 'background.default' : 'grey.100',
                        borderRadius: 1,
                        border: 1,
                        borderColor: theme.palette.mode === 'dark' ? 'divider' : 'grey.300',
                      })}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block' }}>
                            期間
                          </Typography>
                          {(selectedGroup.start_date || selectedGroup.end_date) ? (
                            <Typography variant="body2" fontWeight={500} color="text.primary" sx={{ fontSize: '0.85rem' }}>
                              {formatDateRange(selectedGroup.start_date, selectedGroup.end_date)}
                            </Typography>
                          ) : (
                            <Typography variant="body2" fontWeight={500} color="text.secondary">
                              未設定
                            </Typography>
                          )}
                        </Box>
                      </Box>

                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Box sx={{
                      width: 4,
                      height: 20,
                      bgcolor: 'secondary.main',
                      borderRadius: 1
                    }} />
                    <Typography variant="h6" color="text.primary" sx={{ fontWeight: 700 }}>
                      所属メンバー
                    </Typography>
                    <Chip
                      label={`${usersInSelectedGroup.length}人`}
                      size="small"
                      color="secondary"
                      sx={{ fontWeight: 600 }}
                    />
                  </Box>
                  {loadingMembers ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                      <CircularProgress size={28} />
                    </Box>
                  ) : membersError ? (
                    <Typography color="error">{membersError}</Typography>
                  ) : usersInSelectedGroup.length > 0 ? (
                    <List dense disablePadding sx={{ overflowY: 'auto' }}>
                      {usersInSelectedGroup.map((user, index) => (
                        <ListItem
                          key={user.id}
                          secondaryAction={
                            <Tooltip title="グループから外す">
                              <IconButton
                                size="small"
                                onClick={() => handleRemoveUser(user.id)}
                                sx={{
                                  color: 'warning.main',
                                  '&:hover': { bgcolor: 'warning.light', color: 'warning.dark' }
                                }}
                              >
                                <PersonRemoveIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          }
                          sx={{
                            borderBottom: index < usersInSelectedGroup.length - 1 ? 1 : 0,
                            borderColor: 'divider',
                            py: 1.5,
                            borderRadius: 1,
                            mb: 0.5,
                            bgcolor: 'background.paper',
                            '&:hover': {
                              bgcolor: 'action.hover',
                            },
                            transition: 'background-color 0.2s',
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                            <Box sx={{
                              width: 32,
                              height: 32,
                              borderRadius: '50%',
                              bgcolor: 'primary.main',
                              color: 'white',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 600,
                              fontSize: '0.875rem',
                            }}>
                              {(user.username || String(user.id))[0].toUpperCase()}
                            </Box>
                            <Typography
                              variant="body2"
                              fontWeight={500}
                              sx={{ flex: 1 }}
                            >
                              {user.username || String(user.id)}
                            </Typography>
                          </Box>
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                      <GroupIcon sx={{ fontSize: 48, color: 'action.disabled', mb: 1 }} />
                      <Typography variant="body2" color="text.secondary">
                        このグループにはまだメンバーがいません
                      </Typography>
                      <Button variant="outlined" size="small" startIcon={<PersonAddIcon />} sx={{ mt: 2 }} onClick={handleOpenAddUserModal}>
                        メンバーを追加
                      </Button>
                    </Box>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
                <Box sx={{ textAlign: 'center' }}>
                  <GroupIcon sx={{ fontSize: 64, color: 'action.disabled', mb: 2 }} />
                  <Typography color="text.secondary">左のリストからグループを選択するか、新規作成してください</Typography>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* 新規グループ作成ダイアログ */}
        <Dialog open={isCreateModalOpen} onClose={handleCloseCreateModal} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
          <DialogTitle>新規グループ作成</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="グループ名"
              fullWidth
              variant="outlined"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              sx={{ mt: 1 }}
            />
            <TextField
              margin="dense"
              label="説明（任意）"
              fullWidth
              multiline
              rows={2}
              variant="outlined"
              value={newGroupDesc}
              onChange={e => setNewGroupDesc(e.target.value)}
            />
            <TextField
              margin="dense"
              label="開始日（任意）"
              type="date"
              fullWidth
              variant="outlined"
              value={newGroupStartDate}
              onChange={e => setNewGroupStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              margin="dense"
              label="終了日（任意）"
              type="date"
              fullWidth
              variant="outlined"
              value={newGroupEndDate}
              onChange={e => setNewGroupEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <FormControl fullWidth margin="dense" variant="outlined" size="small" sx={{ mt: 1 }}>
              <InputLabel>メンバー（複数選択可）</InputLabel>
              <Select
                multiple
                value={newGroupUsers}
                label="メンバー（複数選択可）"
                open={newGroupSelectOpen}
                onOpen={() => setNewGroupSelectOpen(true)}
                onClose={() => setNewGroupSelectOpen(false)}
                onChange={e => setNewGroupUsers(Array.isArray(e.target.value) ? e.target.value : [])}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((userId) => {
                      const id = parseInt(userId, 10);
                      const user = users.find(u => u.id === id);
                      const displayName = user?.username || user?.name || user?.full_name || user?.email || userId;
                      return <Chip key={userId} label={displayName} size="small" />;
                    })}
                  </Box>
                )}
              >
                {users.map((user) => (
                  <MenuItem
                    key={user.id}
                    value={String(user.id)}
                    sx={{
                      '&.Mui-selected': {
                        backgroundColor: 'rgba(25, 118, 210, 0.2) !important',
                        '&:hover': { backgroundColor: 'rgba(25, 118, 210, 0.3) !important' },
                      },
                      '&.Mui-selected.Mui-focusVisible': { backgroundColor: 'rgba(25, 118, 210, 0.3) !important' },
                    }}
                  >
                    {user.username || user.name || user.full_name || user.email}
                  </MenuItem>
                ))}
                {users.length > 0 && (
                  <>
                    <Divider />
                    <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', zIndex: 1, width: '100%', display: 'flex', justifyContent: 'flex-end', py: 1, px: 1 }} onClick={(e) => e.stopPropagation()}>
                      <Button onClick={() => setNewGroupSelectOpen(false)} size="small" variant="contained">
                        完了
                      </Button>
                    </Box>
                  </>
                )}
              </Select>
            </FormControl>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={handleCloseCreateModal}>キャンセル</Button>
            <Button onClick={handleCreateGroup} variant="contained" disabled={!newGroupName.trim()}>
              作成
            </Button>
          </DialogActions>
        </Dialog>

        {/* グループ編集ダイアログ */}
        <Dialog open={isEditModalOpen} onClose={handleCloseEditModal} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
          <DialogTitle>グループを編集</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="グループ名"
              fullWidth
              variant="outlined"
              value={editGroupName}
              onChange={e => setEditGroupName(e.target.value)}
              sx={{ mt: 1 }}
            />
            <TextField
              margin="dense"
              label="説明（任意）"
              fullWidth
              multiline
              rows={2}
              variant="outlined"
              value={editGroupDesc}
              onChange={e => setEditGroupDesc(e.target.value)}
            />
            <TextField
              margin="dense"
              label="開始日（任意）"
              type="date"
              fullWidth
              variant="outlined"
              value={editGroupStartDate}
              onChange={e => setEditGroupStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              margin="dense"
              label="終了日（任意）"
              type="date"
              fullWidth
              variant="outlined"
              value={editGroupEndDate}
              onChange={e => setEditGroupEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={handleCloseEditModal}>キャンセル</Button>
            <Button onClick={handleSaveEditGroup} variant="contained" disabled={!editGroupName.trim() || editSaving}>
              {editSaving ? '保存中...' : '保存'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* メンバー追加ダイアログ */}
        <Dialog open={isAddUserModalOpen} onClose={handleCloseAddUserModal} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 2 } }}>
          <DialogTitle>メンバーを追加</DialogTitle>
          <DialogContent>
            <FormControl fullWidth margin="dense" variant="outlined" size="small">
              <InputLabel>ユーザー（複数選択可）</InputLabel>
              <Select
                multiple
                value={usersToAdd}
                label="ユーザー（複数選択可）"
                open={addUserSelectOpen}
                onOpen={() => setAddUserSelectOpen(true)}
                onClose={() => setAddUserSelectOpen(false)}
                onChange={e => setUsersToAdd(Array.isArray(e.target.value) ? e.target.value : [])}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((userId) => {
                      const id = parseInt(userId, 10);
                      const user = users.find(u => u.id === id);
                      const displayName = user?.username || user?.name || user?.full_name || user?.email || userId;
                      return <Chip key={userId} label={displayName} size="small" />;
                    })}
                  </Box>
                )}
              >
                {usersNotInSelectedGroup.map((user) => (
                  <MenuItem
                    key={user.id}
                    value={String(user.id)}
                    sx={{
                      '&.Mui-selected': {
                        backgroundColor: 'rgba(25, 118, 210, 0.2) !important',
                        '&:hover': { backgroundColor: 'rgba(25, 118, 210, 0.3) !important' },
                      },
                      '&.Mui-selected.Mui-focusVisible': { backgroundColor: 'rgba(25, 118, 210, 0.3) !important' },
                    }}
                  >
                    {user.username || user.name || user.full_name || user.email}
                  </MenuItem>
                ))}
                {usersNotInSelectedGroup.length > 0 && (
                  <>
                    <Divider />
                    <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', zIndex: 1, width: '100%', display: 'flex', justifyContent: 'flex-end', py: 1, px: 1 }} onClick={(e) => e.stopPropagation()}>
                      <Button onClick={() => setAddUserSelectOpen(false)} size="small" variant="contained">
                        完了
                      </Button>
                    </Box>
                  </>
                )}
              </Select>
            </FormControl>
            {usersNotInSelectedGroup.length === 0 && selectedGroup && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                追加できるユーザーがいません（全員が既にこのグループに所属しています）
              </Typography>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={handleCloseAddUserModal}>キャンセル</Button>
            <Button onClick={handleAddUserToGroup} variant="contained" disabled={usersToAdd.length === 0}>
              追加
            </Button>
          </DialogActions>
        </Dialog>

        {/* グループ会議作成ダイアログ */}
        <Dialog open={isCreateMeetingModalOpen} onClose={handleCloseCreateMeetingModal} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
          <DialogTitle>会議を作成（グループのメンバーが参加者）</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="タイトル"
              fullWidth
              variant="outlined"
              value={meetingTitle}
              onChange={e => setMeetingTitle(e.target.value)}
              placeholder={selectedGroup ? `${selectedGroup.name} 会議` : ''}
              sx={{ mt: 1 }}
            />
            <TextField
              margin="dense"
              label="実施日"
              type="date"
              fullWidth
              variant="outlined"
              value={meetingDate}
              onChange={e => setMeetingDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
              <TextField
                margin="dense"
                label="開始時刻"
                type="time"
                fullWidth
                variant="outlined"
                value={meetingStartTime}
                onChange={e => setMeetingStartTime(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 300 }}
              />
              <TextField
                margin="dense"
                label="終了時刻"
                type="time"
                fullWidth
                variant="outlined"
                value={meetingEndTime}
                onChange={e => setMeetingEndTime(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ step: 300 }}
              />
            </Box>
            <TextField
              margin="dense"
              label="場所（任意）"
              fullWidth
              variant="outlined"
              value={meetingLocation}
              onChange={e => setMeetingLocation(e.target.value)}
            />
            <Box
              sx={(theme) => ({
                mt: 2,
                p: 1.5,
                bgcolor: theme.palette.mode === 'dark' ? 'background.default' : 'grey.100',
                borderRadius: 1,
              })}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                参加者（グループのメンバー）
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {usersInSelectedGroup.map((u) => (
                  <Chip key={u.id} label={u.username || u.name || u.email || `User ${u.id}`} size="small" variant="outlined" />
                ))}
              </Box>
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={handleCloseCreateMeetingModal}>キャンセル</Button>
            <Button onClick={handleCreateMeeting} variant="contained" disabled={meetingSaving || !meetingDate || !meetingStartTime || !meetingEndTime} startIcon={meetingSaving ? <CircularProgress size={16} /> : <MeetingRoomIcon />}>
              {meetingSaving ? '作成中...' : '会議を作成'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* 確認ダイアログ */}
        <Dialog open={confirmDialog.open} onClose={closeConfirmDialog} maxWidth="xs" fullWidth>
          <DialogTitle>確認</DialogTitle>
          <DialogContent>
            <Typography>{confirmDialog.message}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={closeConfirmDialog}>キャンセル</Button>
            <Button onClick={confirmDialog.onConfirm} color="error" variant="contained">削除</Button>
          </DialogActions>
        </Dialog>

        <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={handleCloseSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
};

export default GroupManagementPage;
