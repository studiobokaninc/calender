import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, CircularProgress, List, ListItem, ListItemText, Paper, IconButton, Avatar, ListItemIcon, Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControl, InputLabel, Select, MenuItem, Snackbar, Alert } from '@mui/material';
import { User } from '../types';
import api from '../services/api';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import UserAddModal, { NewUserData } from '../components/UserAddModal';
import { SelectChangeEvent } from '@mui/material';

interface EditUserData {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: string;
}

const UserManagementPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [currentEditUser, setCurrentEditUser] = useState<EditUserData | null>(null);
  const [snackbar, setSnackbar] = useState<{open: boolean, message: string, severity: 'success' | 'error'}>({
    open: false,
    message: '',
    severity: 'success'
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<User[]>('/api/users');
      setUsers(response.data);
    } catch (err) {
      console.error("Error fetching users:", err);
      setError('ユーザーデータの取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const handleAddUserClick = () => {
    setIsAddModalOpen(true);
  };

  const handleCloseAddModal = () => {
    setIsAddModalOpen(false);
  };

  const handleSaveNewUser = async (newUserData: NewUserData): Promise<void> => {
    console.log("Saving new user:", newUserData);
    try {
      const response = await api.post<User>('/api/users', newUserData);
      const createdUser = response.data;
      
      setUsers(prevUsers => [...prevUsers, createdUser]);
      setSnackbar({
        open: true,
        message: 'ユーザーが正常に追加されました',
        severity: 'success'
      });
      
      return;
    } catch (error) {
      console.error("Failed to save new user:", error);
      setSnackbar({
        open: true,
        message: 'ユーザーの追加に失敗しました',
        severity: 'error'
      });
    }
  };

  const handleEditUserClick = (user: User) => {
    setCurrentEditUser({
      id: String(user.id),
      username: user.username || '',
      full_name: user.full_name || '',
      email: user.email || '',
      role: user.role || 'user'
    });
    setIsEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setCurrentEditUser(null);
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement | { name?: string; value: unknown }> | SelectChangeEvent<string>) => {
    const { name, value } = e.target;
    if (currentEditUser && name) {
      setCurrentEditUser({
        ...currentEditUser,
        [name]: value
      });
    }
  };

  const handleSaveEditUser = async () => {
    if (!currentEditUser) return;
    
    try {
      const response = await api.put<User>(`/api/users/${currentEditUser.id}`, currentEditUser);
      const updatedUser = response.data;
      
      setUsers(prevUsers => 
        prevUsers.map(user => 
          user.id === updatedUser.id ? updatedUser : user
        )
      );
      
      setSnackbar({
        open: true,
        message: 'ユーザー情報が正常に更新されました',
        severity: 'success'
      });
      
      handleCloseEditModal();
    } catch (error) {
      console.error("Failed to update user:", error);
      setSnackbar({
        open: true,
        message: 'ユーザー情報の更新に失敗しました',
        severity: 'error'
      });
    }
  };

  const handleDeleteUserClick = async (userId: string, userName: string = '') => {
    if (window.confirm(`${userName}さんを本当に削除しますか？`)) {
      try {
        await api.delete(`/api/users/${userId}`);
        setUsers(prevUsers => prevUsers.filter(user => String(user.id) !== userId));
        setSnackbar({
          open: true,
          message: 'ユーザーが正常に削除されました',
          severity: 'success'
        });
      } catch (err) {
        console.error(`Error deleting user ${userId}:`, err);
        setSnackbar({
          open: true,
          message: 'ユーザーの削除に失敗しました',
          severity: 'error'
        });
      }
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbar({...snackbar, open: false});
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" gutterBottom component="div">
          ユーザー管理
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAddUserClick}
        >
          ユーザー追加
        </Button>
      </Box>

      {loading && <CircularProgress sx={{ display: 'block', margin: 'auto', my: 4 }} />}
      {error && <Typography color="error" sx={{ my: 2 }}>{error}</Typography>}

      {!loading && !error && (
        <List>
          {users.length > 0 ? (
            users.map((user) => (
              <ListItem
                key={user.id}
                divider
                secondaryAction={
                  <>
                    <IconButton edge="end" aria-label="edit" onClick={() => handleEditUserClick(user)} sx={{ mr: 1 }}>
                      <EditIcon />
                    </IconButton>
                    <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteUserClick(String(user.id), user.name)}>
                      <DeleteIcon />
                    </IconButton>
                  </>
                }
              >
                <ListItemIcon sx={{ minWidth: 56 }}>
                  <Avatar src={user.iconUrl} alt={user.name || user.username || ''}>
                    {user.iconUrl ? null : (user.name || user.username || '')?.[0]?.toUpperCase()}
                  </Avatar>
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Typography variant="body1">{user.name || user.username}</Typography>
                      <Typography variant="body2" color="text.secondary">メール: {user.email || '未設定'}</Typography>
                      <Typography variant="body2" color="text.secondary">役割: {user.role || '未設定'}</Typography>
                    </Box>
                  }
                />
              </ListItem>
            ))
          ) : (
            <Typography sx={{ my: 2 }}>登録されているユーザーはいません。</Typography>
          )}
        </List>
      )}

      <UserAddModal 
        open={isAddModalOpen}
        onClose={handleCloseAddModal}
        onSave={handleSaveNewUser}
      />

      {/* ユーザー編集モーダル */}
      <Dialog open={isEditModalOpen} onClose={handleCloseEditModal} maxWidth="sm" fullWidth>
        <DialogTitle>ユーザー情報の編集</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="ユーザーID"
              name="username"
              value={currentEditUser?.username || ''}
              onChange={handleEditChange}
              fullWidth
            />
            <TextField
              label="氏名"
              name="full_name"
              value={currentEditUser?.full_name || ''}
              onChange={handleEditChange}
              fullWidth
            />
            <TextField
              label="メールアドレス"
              name="email"
              value={currentEditUser?.email || ''}
              onChange={handleEditChange}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>役割</InputLabel>
              <Select
                name="role"
                value={currentEditUser?.role || 'user'}
                onChange={handleEditChange}
                label="役割"
              >
                <MenuItem value="user">一般ユーザー</MenuItem>
                <MenuItem value="admin">管理者</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEditModal}>キャンセル</Button>
          <Button onClick={handleSaveEditUser} variant="contained" color="primary">
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 操作結果の通知 */}
      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={5000} 
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default UserManagementPage;
