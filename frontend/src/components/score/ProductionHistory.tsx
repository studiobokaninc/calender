import React from 'react';
import {
    List,
    ListItem,
    ListItemText,
    ListItemAvatar,
    Avatar,
    Typography,
    Paper,
    Box,
    Divider,
    alpha,
    useTheme,
    Chip
} from '@mui/material';
import { Notification, UserMessage, User } from '../../types';
import { 
    Notifications as NotificationIcon, 
    Chat as ChatIcon,
    Info as InfoIcon,
    Warning as WarningIcon,
    Error as ErrorIcon
} from '@mui/icons-material';

interface ProductionHistoryProps {
    notifications: Notification[];
    messages: UserMessage[];
    loading?: boolean;
    users?: User[];
}

export const ProductionHistory: React.FC<ProductionHistoryProps> = ({ notifications, messages, loading, users }) => {
    const theme = useTheme();

    // Combine and sort by date
    const combinedHistory = [
        ...notifications.map(n => ({ ...n, entryType: 'notification' as const })),
        ...messages.map(m => ({ ...m, entryType: 'message' as const }))
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (combinedHistory.length === 0 && !loading) {
        return (
            <Box sx={{ p: 5, textAlign: 'center', bgcolor: alpha(theme.palette.background.paper, 0.5), borderRadius: 3 }}>
                <InfoIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                <Typography color="text.secondary">履歴はありません。</Typography>
            </Box>
        );
    }

    const getIcon = (item: any) => {
        if (item.entryType === 'message') return <ChatIcon color="primary" />;
        
        switch (item.type) {
            case 'warning': return <WarningIcon color="warning" />;
            case 'error': return <ErrorIcon color="error" />;
            default: return <NotificationIcon color="info" />;
        }
    };

    const getSenderText = (item: any) => {
        if (item.entryType !== 'message') return '';

        // 1. Try to find the user details from the frontend users state (most comprehensive)
        const dbUser = users?.find(u => u.id === item.author_id);
        if (dbUser) {
            const fullName = (dbUser.full_name || dbUser.name || '').trim();
            const username = (dbUser.username || '').trim();
            const email = (dbUser.email || '').trim();

            const baseName = fullName || username || item.author_name || `ユーザー #${item.author_id}`;
            const details: string[] = [];
            
            if (username && username !== baseName) {
                details.push(username);
            }
            if (email) {
                details.push(email);
            }
            
            if (details.length > 0) {
                return `${baseName} (${details.join(' / ')})`;
            }
            return baseName;
        }

        // 2. Fallback to properties returned by the backend response
        const baseName = (item.author_name || '').trim() || `ユーザー #${item.author_id}`;
        const details: string[] = [];
        
        if (item.author_username && item.author_username !== item.author_name) {
            details.push(item.author_username);
        }
        if (item.author_email) {
            details.push(item.author_email);
        }
        
        if (details.length > 0) {
            return `${baseName} (${details.join(' / ')})`;
        }
        return baseName;
    };

    return (
        <Paper sx={{ borderRadius: 3, overflow: 'hidden', boxShadow: 2 }}>
            <List sx={{ p: 0 }}>
                {combinedHistory.map((item: any, index) => (
                    <React.Fragment key={`${item.entryType}-${item.id}`}>
                        <ListItem alignItems="flex-start" sx={{ 
                            py: 2, 
                            px: 3,
                            bgcolor: item.entryType === 'notification' && !item.is_read ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
                            '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.5) }
                        }}>
                            <ListItemAvatar>
                                <Avatar sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                                    {getIcon(item)}
                                </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                                primary={
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                                                {item.entryType === 'message' ? `メッセージ (${getSenderText(item)})` : item.type.toUpperCase()}
                                            </Typography>
                                            {item.entryType === 'notification' && !item.is_read && (
                                                <Chip label="NEW" size="small" color="primary" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 900 }} />
                                            )}
                                        </Box>
                                        <Typography variant="caption" color="text.secondary">
                                            {new Date(item.created_at).toLocaleString()}
                                        </Typography>
                                    </Box>
                                }
                                secondary={
                                    <Typography
                                        variant="body2"
                                        color="text.primary"
                                        sx={{ display: 'inline', opacity: 0.8 }}
                                    >
                                        {item.entryType === 'message' ? item.body : item.body}
                                        {item.entryType === 'message' && item.shot_id && (
                                            <Chip label={`SHOT-${item.shot_id}`} size="small" variant="outlined" sx={{ ml: 1, height: 18, fontSize: '0.6rem' }} />
                                        )}
                                    </Typography>
                                }
                            />
                        </ListItem>
                        {index < combinedHistory.length - 1 && <Divider component="li" />}
                    </React.Fragment>
                ))}
            </List>
        </Paper>
    );
};
