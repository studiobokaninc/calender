import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Box, Typography, CircularProgress, Paper, List, ListItem, ListItemButton,
    ListItemText, Divider, Button, IconButton, Grid, TextField, Dialog,
    DialogActions, DialogContent, DialogContentText, DialogTitle, Select,
    MenuItem, FormControl, InputLabel, Tooltip,
    Stack,
    Snackbar, Alert
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
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

    // --- Modal States ---
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDesc, setNewGroupDesc] = useState('');
    const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
    const [userToAdd, setUserToAdd] = useState<string>('');

    const [snackbar, setSnackbar] = useState<{open: boolean, message: string, severity: 'success' | 'error' | 'info' | 'warning'}>({ open: false, message: '', severity: 'info' });

    // --- Fetch Data --- 
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
                console.log(`Fetching members for group ID: ${selectedGroup.id}`);
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

    // --- Memos for derived data ---
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

    // --- Handlers ---
    const handleGroupSelect = (group: Group) => {
        setSelectedGroup(group);
    };

    // ★★★ Implement Create Group Handler ★★★
    const handleOpenCreateModal = () => setIsCreateModalOpen(true);
    const handleCloseCreateModal = () => {
        setIsCreateModalOpen(false);
        setNewGroupName('');
        setNewGroupDesc('');
    }
    const handleCreateGroup = async () => {
        if (!newGroupName) return;
        try {
            console.log("Creating Group:", newGroupName, newGroupDesc);
            await api.post('/api/groups', { name: newGroupName, description: newGroupDesc });
            await fetchInitialData(); // Refresh data after creation
            handleCloseCreateModal();
        } catch (err) {
            console.error("Failed to create group:", err);
            setError('グループの作成に失敗しました。'); // Show error message
        }
    }

    // ★★★ Implement Add User Handler ★★★
    const handleOpenAddUserModal = () => setIsAddUserModalOpen(true);
    const handleCloseAddUserModal = () => {
        setIsAddUserModalOpen(false);
        setUserToAdd('');
    }
    const handleAddUserToGroup = async () => {
        if (!selectedGroup || !userToAdd) return;
        try {
            console.log("Adding User:", userToAdd, "to Group:", selectedGroup.id);
            await api.post('/api/user_groups', { user_id: userToAdd, group_id: selectedGroup.id });
            await fetchInitialData(); // Refresh data after adding user
            handleCloseAddUserModal();
        } catch (err) {
            console.error("Failed to add user to group:", err);
            setError('ユーザーのグループ追加に失敗しました。');
        }
    }

    // ★★★ Implement Remove User Handler ★★★
    const handleRemoveUser = async (userId: number) => {
        if (!selectedGroup) return;
        if (window.confirm(`${userMap.get(userId) || `ID ${userId}`} をグループ ${selectedGroup.name} から削除しますか？`)) {
            try {
                console.log("Removing User:", userId, "from Group:", selectedGroup.id);
                await api.delete(`/api/user_groups/${String(userId)}/${String(selectedGroup.id)}`);
                setSelectedGroupMembers(prev => prev.filter(ug => ug.user_id !== userId));
            } catch (err) {
                console.error("Failed to remove user from group:", err);
                setError('ユーザーのグループからの削除に失敗しました。');
            }
        }
    }

    // ★★★ グループ削除ハンドラを追加 ★★★
    const handleDeleteGroup = async () => {
        if (!selectedGroup) return; // グループが選択されていなければ何もしない

        if (window.confirm(`グループ「${selectedGroup.name}」を削除してもよろしいですか？このグループに関連するユーザーの割り当ても解除されます。`)) {
            try {
                setLoading(true); // ★ ローディング開始
                console.log("Deleting Group:", selectedGroup.id);
                // ★ バックエンド API が期待する ID の型を確認 (number? string?)
                //    ここでは selectedGroup.id (number) をそのまま使う
                await api.delete(`/api/groups/${selectedGroup.id}`);

                // 削除成功時の処理
                setSnackbar({ open: true, message: 'グループが削除されました', severity: 'success' });
                setSelectedGroup(null); // 選択を解除
                await fetchInitialData(); // グループリストを再取得

            } catch (err: any) {
                console.error("Failed to delete group:", err);
                const errorDetail = err.response?.data?.detail || err.message || '不明なエラー';
                setSnackbar({ open: true, message: `グループの削除に失敗しました: ${errorDetail}`, severity: 'error' });
            } finally {
                setLoading(false); // ★ ローディング終了
            }
        }
    };
    
    // ★ Snackbar クローズハンドラ
    const handleCloseSnackbar = (event?: React.SyntheticEvent | Event, reason?: string) => {
        if (reason === 'clickaway') return;
        setSnackbar({ ...snackbar, open: false });
    };

    // --- Render Logic ---
    if (loading) return <CircularProgress />;
    if (error) return <Typography color="error">{error}</Typography>;

    return (
        <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)' }}> {/* Adjust height based on AppBar */}
            {/* Left Panel: Group List */}
            <Paper sx={{ width: 250, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ p: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6">グループ</Typography>
                    <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleOpenCreateModal}>
                        新規作成
                    </Button>
                </Box>
                <Divider />
                <List sx={{ overflowY: 'auto', flexGrow: 1 }}>
                    {groups.map((group) => (
                        <ListItem key={group.id} disablePadding>
                            <ListItemButton 
                                selected={selectedGroup?.id === group.id}
                                onClick={() => handleGroupSelect(group)}
                            >
                                <ListItemText primary={group.name} secondary={group.description} />
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>
            </Paper>

            {/* Right Panel: Group Details */}
            <Box sx={{ flexGrow: 1, p: 2, overflowY: 'auto' }}>
                {selectedGroup ? (
                    <>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Typography variant="h5">{selectedGroup.name}</Typography>
                            <Stack direction="row" spacing={1}>
                                <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={handleOpenAddUserModal}>
                                    ユーザー追加
                                </Button>
                                <Tooltip title="グループを削除">
                                    <IconButton edge="end" aria-label="delete group" size="small" onClick={handleDeleteGroup} color="error" disabled={loading}>
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Stack>
                        </Box>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            {selectedGroup.description || '説明なし'}
                        </Typography>
                        <Divider sx={{ my: 2 }} />
                        <Typography variant="subtitle1" gutterBottom>所属ユーザー</Typography>
                        {loadingMembers ? (
                            <CircularProgress size={24} />
                        ) : membersError ? (
                            <Typography color="error">{membersError}</Typography>
                        ) : usersInSelectedGroup.length > 0 ? (
                            <List dense>
                                {usersInSelectedGroup.map((user) => (
                                    <ListItem 
                                        key={user.id} 
                                        secondaryAction={
                                            <Tooltip title="グループから削除">
                                                <IconButton edge="end" aria-label="delete" size="small" onClick={() => handleRemoveUser(user.id)}>
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        }
                                    >
                                        <ListItemText primary={user.name || user.email} />
                                    </ListItem>
                                ))}
                            </List>
                        ) : (
                            <Typography variant="body2" color="text.secondary">このグループにはまだユーザーがいません。</Typography>
                        )}
                    </>
                ) : (
                    <Typography>グループを選択してください。</Typography>
                )}
            </Box>

            {/* Create Group Modal */}
            <Dialog open={isCreateModalOpen} onClose={handleCloseCreateModal}>
                 <DialogTitle>新規グループ作成</DialogTitle>
                 <DialogContent>
                     <TextField
                         autoFocus
                         margin="dense"
                         label="グループ名"
                         type="text"
                         fullWidth
                         variant="standard"
                         value={newGroupName}
                         onChange={(e) => setNewGroupName(e.target.value)}
                     />
                     <TextField
                         margin="dense"
                         label="説明 (任意)"
                         type="text"
                         fullWidth
                         multiline
                         rows={2}
                         variant="standard"
                         value={newGroupDesc}
                         onChange={(e) => setNewGroupDesc(e.target.value)}
                     />
                 </DialogContent>
                 <DialogActions>
                     <Button onClick={handleCloseCreateModal}>キャンセル</Button>
                     <Button onClick={handleCreateGroup} disabled={!newGroupName}>作成</Button>
                 </DialogActions>
            </Dialog>

            {/* Add User to Group Modal */}
            <Dialog open={isAddUserModalOpen} onClose={handleCloseAddUserModal} fullWidth maxWidth="xs">
                <DialogTitle>ユーザーをグループに追加</DialogTitle>
                <DialogContent>
                    <FormControl fullWidth margin="dense">
                        <InputLabel>ユーザー</InputLabel>
                        <Select
                            value={userToAdd}
                            label="ユーザー"
                            onChange={(e) => setUserToAdd(e.target.value as string)}
                        >
                            <MenuItem value="" disabled><em>ユーザーを選択...</em></MenuItem>
                            {usersNotInSelectedGroup.map(user => (
                                <MenuItem key={user.id} value={user.id}>{user.name || user.email}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseAddUserModal}>キャンセル</Button>
                    <Button onClick={handleAddUserToGroup} disabled={!userToAdd}>追加</Button>
                </DialogActions>
            </Dialog>

            <Snackbar 
                open={snackbar.open} 
                autoHideDuration={6000} 
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default GroupManagementPage; 