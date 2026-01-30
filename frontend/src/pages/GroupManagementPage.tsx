import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Typography, CircularProgress, Paper, List, ListItem, ListItemButton,
  ListItemText, Divider, Button, IconButton, TextField, Dialog,
  DialogActions, DialogContent, DialogTitle, Select, MenuItem, FormControl,
  InputLabel, Tooltip, Stack, Snackbar, Alert, Card, CardContent, InputAdornment,
  Chip
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import GroupIcon from '@mui/icons-material/Group';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import api from '../services/api';
import { Group, User, UserGroup } from '../types';

const GroupManagementPage: React.FC = () => {
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
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [usersToAdd, setUsersToAdd] = useState<string[]>([]);
  const [addUserSelectOpen, setAddUserSelectOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupDesc, setEditGroupDesc] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({ open: false, message: '', severity: 'info' });

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
    setIsCreateModalOpen(true);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await api.post('/api/groups', { name: newGroupName.trim(), description: newGroupDesc.trim() || undefined });
      await fetchInitialData();
      handleCloseCreateModal();
      setSnackbar({ open: true, message: `グループ「${newGroupName}」を作成しました`, severity: 'success' });
    } catch (err) {
      console.error("Failed to create group:", err);
      setSnackbar({ open: true, message: 'グループの作成に失敗しました', severity: 'error' });
    }
  };

  const handleCloseCreateModal = () => {
    setIsCreateModalOpen(false);
    setNewGroupName('');
    setNewGroupDesc('');
  };

  const handleOpenEditModal = () => {
    if (!selectedGroup) return;
    setEditGroupName(selectedGroup.name || '');
    setEditGroupDesc(selectedGroup.description || '');
    setIsEditModalOpen(true);
  };

  const handleSaveEditGroup = async () => {
    if (!selectedGroup) return;
    setEditSaving(true);
    try {
      await api.put(`/api/groups/${selectedGroup.id}`, {
        name: editGroupName.trim(),
        description: editGroupDesc.trim() || undefined,
      });
      setGroups(prev => prev.map(g => g.id === selectedGroup.id ? { ...g, name: editGroupName.trim(), description: editGroupDesc.trim() || undefined } : g));
      setSelectedGroup(prev => prev && prev.id === selectedGroup.id ? { ...prev, name: editGroupName.trim(), description: editGroupDesc.trim() || undefined } : prev);
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
      for (const userId of usersToAdd) {
        await api.post('/api/user_groups', { user_id: Number(userId), group_id: selectedGroup.id });
      }
      const res = await api.get<UserGroup[]>(`/api/user_groups?group_id=${selectedGroup.id}`);
      setSelectedGroupMembers(res.data);
      handleCloseAddUserModal();
      setSnackbar({ open: true, message: usersToAdd.length === 1 ? 'メンバーを追加しました' : `${usersToAdd.length}人を追加しました`, severity: 'success' });
    } catch (err) {
      console.error("Failed to add user to group:", err);
      setSnackbar({ open: true, message: 'ユーザーの追加に失敗しました', severity: 'error' });
    }
  };

  const handleRemoveUser = async (userId: number) => {
    if (!selectedGroup) return;
    const name = userMap.get(userId) || `ID ${userId}`;
    if (!window.confirm(`${name} をグループ「${selectedGroup.name}」から削除しますか？`)) return;
    try {
      await api.delete(`/api/user_groups/${String(userId)}/${String(selectedGroup.id)}`);
      setSelectedGroupMembers(prev => prev.filter(ug => ug.user_id !== userId));
      setSnackbar({ open: true, message: 'メンバーを削除しました', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: '削除に失敗しました', severity: 'error' });
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroup) return;
    if (!window.confirm(`グループ「${selectedGroup.name}」を削除してもよろしいですか？関連するメンバー割り当ても解除されます。`)) return;
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
  };

  const handleCloseSnackbar = (_?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    setSnackbar(s => ({ ...s, open: false }));
  };

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
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      {/* 左: グループ一覧 */}
      <Paper
        elevation={0}
        sx={{
          width: 280,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 0,
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
            filteredGroups.map((group) => (
              <ListItem key={group.id} disablePadding>
                <ListItemButton
                  selected={selectedGroup?.id === group.id}
                  onClick={() => handleGroupSelect(group)}
                  sx={{ py: 1.5, borderRadius: 0 }}
                >
                  <ListItemText
                    primary={group.name}
                    secondary={group.description || null}
                    primaryTypographyProps={{ fontWeight: selectedGroup?.id === group.id ? 600 : 500 }}
                  />
                </ListItemButton>
              </ListItem>
            ))
          )}
        </List>
      </Paper>

      {/* 右: 選択グループの詳細 */}
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'grey.50' }}>
        {selectedGroup ? (
          <Card sx={{ m: 2, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 2 }}>
            <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', pb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                <Box>
                  <Typography variant="h5" fontWeight={600}>{selectedGroup.name}</Typography>
                  {selectedGroup.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {selectedGroup.description}
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Tooltip title="編集">
                    <IconButton size="small" onClick={handleOpenEditModal} color="primary">
                      <EditIcon />
                    </IconButton>
                  </Tooltip>
                  <Button variant="outlined" size="small" startIcon={<PersonAddIcon />} onClick={handleOpenAddUserModal}>
                    メンバー追加
                  </Button>
                  <Tooltip title="グループを削除">
                    <IconButton size="small" onClick={handleDeleteGroup} color="error">
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>所属メンバー ({usersInSelectedGroup.length}人)</Typography>
              {loadingMembers ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress size={28} />
                </Box>
              ) : membersError ? (
                <Typography color="error">{membersError}</Typography>
              ) : usersInSelectedGroup.length > 0 ? (
                <List dense disablePadding sx={{ overflowY: 'auto' }}>
                  {usersInSelectedGroup.map((user) => (
                    <ListItem
                      key={user.id}
                      secondaryAction={
                        <Tooltip title="グループから削除">
                          <IconButton size="small" onClick={() => handleRemoveUser(user.id)} color="error">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                      sx={{ borderBottom: 1, borderColor: 'divider', py: 1 }}
                    >
                      <ListItemText primary={user.name || user.email} />
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
                    const name = userMap.get(id);
                    return <Chip key={userId} label={name || userId} size="small" />;
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
                  {user.name || user.email}
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

      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={handleCloseSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default GroupManagementPage;
