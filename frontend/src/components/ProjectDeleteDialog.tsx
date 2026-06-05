import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';

interface ProjectDeleteDialogProps {
  open: boolean;
  projectName: string;
  onClose: () => void;
  onDelete: () => void;
}

const ProjectDeleteDialog: React.FC<ProjectDeleteDialogProps> = ({
  open,
  projectName,
  onClose,
  onDelete,
}) => {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>プロジェクトの削除</DialogTitle>
      <DialogContent>
        <DialogContentText>
          「{projectName}」を削除しますか？
          この操作は取り消せません。関連するタスクとイベントもすべて削除されます。
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button onClick={onDelete} color="error" autoFocus>
          削除
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProjectDeleteDialog; 