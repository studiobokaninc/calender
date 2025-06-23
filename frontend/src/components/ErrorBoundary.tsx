import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Typography, Button, Stack, Alert } from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  componentName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`エラーバウンダリでエラーが捕捉されました ${this.props.componentName ? `[${this.props.componentName}]` : ''}:`, error, errorInfo);
    this.setState({ errorInfo });
  }

  resetError = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  }

  reloadPage = (): void => {
    window.location.reload();
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // カスタムフォールバックUIがあれば使用、なければデフォルトのエラー表示
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // ガントチャートのエラーかどうかをチェック
      const isGanttError = this.state.error?.message?.includes('Cannot read properties of undefined (reading \'start\')')
        || this.state.errorInfo?.componentStack?.includes('Gantt')
        || this.state.errorInfo?.componentStack?.includes('TaskGanttContent');

      return (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="h6" component="h3" gutterBottom>
              {isGanttError 
                ? 'ガントチャートの読み込み中にエラーが発生しました' 
                : 'コンポーネントの読み込み中にエラーが発生しました'}
            </Typography>
          </Alert>
          
          <Typography variant="body2" sx={{ mb: 2 }}>
            {isGanttError 
              ? 'タスクデータの形式に問題があるか、データが空です。' 
              : this.state.error?.message || 'エラーの詳細は開発者コンソールを確認してください'}
          </Typography>
          
          {isGanttError && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              エラー詳細: {this.state.error?.message}
            </Typography>
          )}
          
          <Stack direction="row" spacing={2} justifyContent="center">
            <Button 
              variant="contained" 
              color="primary"
              startIcon={<ReplayIcon />}
              onClick={this.resetError}
            >
              再試行
            </Button>
            
            <Button 
              variant="outlined" 
              color="secondary"
              onClick={this.reloadPage}
            >
              ページを再読み込み
            </Button>
          </Stack>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary; 