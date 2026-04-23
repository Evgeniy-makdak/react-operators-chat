import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ArrowDropDown, Search } from '@mui/icons-material';
import {
  Box,
  CircularProgress,
  FormControl,
  InputAdornment,
  MenuItem,
  Popover,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { UsersApi } from '@shared/api/baseQuerys';
import { appStore } from '@shared/model/app_store/AppStore';

interface IUser {
  id: number;
  firstName?: string;
  middleName?: string;
  surname?: string;
  fullName?: string;
}

interface TransferOperatorSelectProps {
  disabled?: boolean;
  /** Смена диалога / пользователя — сбрасывает отображаемое имя в поле. */
  selectionResetKey?: string;
  onOperatorSelected: (operatorId: number, operatorLabel: string) => void;
}

export function TransferOperatorSelect({
  disabled = false,
  selectionResetKey = '',
  onOperatorSelected,
}: TransferOperatorSelectProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const surface = disabled
    ? theme.palette.action.disabledBackground
    : theme.palette.background.paper;
  const borderSubtle = isDark ? 'rgba(255, 255, 255, 0.23)' : '#ccc';
  const borderHover = isDark ? 'rgba(255, 255, 255, 0.45)' : '#000';

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [operators, setOperators] = useState<IUser[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pickedDisplay, setPickedDisplay] = useState<{ label: string } | null>(null);
  const selectRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const hasLoadedRef = useRef(false);
  const isMountedRef = useRef(true);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const open = Boolean(anchorEl);
  const branchId = appStore((state) => state.selectedBranchState?.id);
  const currentUserId = appStore((state) => state.authId);

  const getOperatorName = (user: IUser) =>
    user.fullName ||
    [user.firstName, user.middleName, user.surname].filter(Boolean).join(' ') ||
    t('chat.userWithId', { id: user.id });

  useEffect(() => {
    setPickedDisplay(null);
  }, [selectionResetKey]);

  const fetchOperators = useCallback(
    async (query: string = '') => {
      if (!isMountedRef.current || !branchId) return;

      try {
        setLoading(true);
        const response = await UsersApi.getListForChatTransfer({
          page: 0,
          limit: 20,
          searchQuery: query,
          filterOptions: { branchId },
          excludeUserId: currentUserId ?? undefined,
        });

        const payload = response.data as IUser[] | { content?: IUser[] } | null | undefined;
        const rawList = Array.isArray(payload)
          ? payload
          : payload && typeof payload === 'object' && Array.isArray(payload.content)
            ? payload.content
            : [];

        const uid = currentUserId != null ? Number(currentUserId) : NaN;
        const list = rawList.filter((u) => u.id !== 1 && u.id !== 2 && u.id !== uid);

        setOperators(list);
        setError('');
        hasLoadedRef.current = true;
      } catch {
        setError(t('chat.usersFetchFailed'));
        hasLoadedRef.current = true;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [branchId, currentUserId, t],
  );

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      hasLoadedRef.current = false;
      return;
    }

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    const delayMs = searchQuery.length > 0 ? 300 : 0;
    searchTimeoutRef.current = setTimeout(() => {
      void fetchOperators(searchQuery);
    }, delayMs);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [open, searchQuery, fetchOperators]);

  useEffect(() => {
    handleClose();
  }, [branchId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (disabled || !branchId) return;
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
    setSearchQuery('');
  };

  const handleSelect = (user: IUser) => {
    const label = getOperatorName(user);
    setPickedDisplay({ label });
    onOperatorSelected(user.id, label);
    handleClose();
  };

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void fetchOperators(searchQuery);
  };

  const mainLine = pickedDisplay?.label ?? t('chat.transferDialogHint');
  const isPlaceholder = !pickedDisplay?.label;

  return (
    <FormControl fullWidth size="small" variant="outlined" sx={{ minWidth: 0, mt: 1.5 }}>
      <Box
        ref={selectRef}
        onClick={handleClick}
        sx={{
          border: '1px solid',
          borderColor: borderSubtle,
          borderRadius: 1,
          px: 1.5,
          py: 1.25,
          minHeight: 48,
          cursor: disabled || !branchId ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          backgroundColor: surface,
          position: 'relative',
          transition: 'border-color 0.15s ease',
          '&:hover': {
            borderColor: disabled || !branchId ? borderSubtle : borderHover,
          },
          opacity: disabled || !branchId ? 0.72 : 1,
        }}>
        <Box
          component="span"
          sx={{
            position: 'absolute',
            top: -7,
            left: 10,
            backgroundColor: surface,
            px: 0.5,
            fontSize: '0.75rem',
            color: 'text.secondary',
            lineHeight: 1,
            zIndex: 1,
          }}>
          {t('chat.transferDialogOpen')}
        </Box>

        <Typography
          variant="body2"
          noWrap
          title={mainLine}
          sx={{
            flex: 1,
            mt: 0.5,
            minWidth: 0,
            color: isPlaceholder ? 'text.secondary' : 'text.primary',
            fontWeight: isPlaceholder ? 400 : 500,
          }}>
          {mainLine}
        </Typography>
        {!disabled && branchId ? (
          <ArrowDropDown sx={{ color: 'action.active', flexShrink: 0 }} />
        ) : null}
      </Box>

      {!disabled && branchId ? (
        <Popover
          open={open}
          anchorEl={anchorEl}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{
            paper: {
              elevation: 8,
              sx: {
                mt: 0.5,
                minWidth: Math.max(selectRef.current?.clientWidth ?? 0, 320),
                maxWidth: 'min(420px, calc(100vw - 32px))',
                borderRadius: 1,
              },
            },
          }}>
          <Box sx={{ p: 1.5, width: '100%', boxSizing: 'border-box' }}>
            <form onSubmit={handleSearchSubmit}>
              <TextField
                inputRef={searchInputRef}
                autoFocus
                fullWidth
                size="small"
                placeholder={t('chat.searchUsersPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search fontSize="small" />
                    </InputAdornment>
                  ),
                }}
                sx={{ mb: 1 }}
              />
            </form>

            <Box sx={{ maxHeight: 280, overflow: 'auto' }}>
              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : error ? (
                <Box sx={{ p: 2, color: 'error.main' }}>{error}</Box>
              ) : operators.length === 0 && hasLoadedRef.current ? (
                <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
                  {searchQuery ? t('chat.usersNotFound') : t('chat.noUsersAvailable')}
                </Box>
              ) : (
                operators.map((user) => (
                  <MenuItem key={user.id} dense onClick={() => handleSelect(user)}>
                    {getOperatorName(user)}
                  </MenuItem>
                ))
              )}
            </Box>
          </Box>
        </Popover>
      ) : null}
    </FormControl>
  );
}
