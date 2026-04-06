import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ArrowDropDown, Close, Search } from '@mui/icons-material';
import {
  Box,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputAdornment,
  MenuItem,
  Popover,
  TextField,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { UsersApi } from '@shared/api/baseQuerys';
import { appStore } from '@shared/model/app_store/AppStore';
import type { ID } from '@shared/types/BaseQueryTypes';

interface IUser {
  id: number;
  firstName?: string;
  middleName?: string;
  surname?: string;
  fullName?: string;
  email?: string;
  isActive?: boolean;
  disabled?: boolean;
  branchId?: number;
  branchName?: string;
  driverId?: number;
}

interface UsersSelectProps {
  selectedUsers: ID[];
  onUsersChange: (users: ID[]) => void;
  onUserSelect?: (userId: number, userName: string, userData?: any) => void;
  isTouched: boolean;
  onBlur: () => void;
  disabled?: boolean;
  usersCache: Map<number, any>;
  onUpdateUsersCache: (users: any[]) => void;
  onCheckExistingSession?: (userId: number) => boolean;
  displayUserName?: string;
}

function UsersSelect({
  selectedUsers,
  onUsersChange,
  onUserSelect,
  onBlur,
  disabled = false,
  usersCache,
  onUpdateUsersCache,
  onCheckExistingSession,
  displayUserName,
}: UsersSelectProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const surface = disabled
    ? theme.palette.action.disabledBackground
    : theme.palette.background.paper;
  const borderSubtle = isDark ? 'rgba(255, 255, 255, 0.23)' : '#ccc';
  const borderHover = isDark ? 'rgba(255, 255, 255, 0.45)' : '#000';

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [users, setUsers] = useState<IUser[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [, setIsBlurred] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const hasLoadedRef = useRef(false);
  const usersCacheRef = useRef<Map<number, any>>(new Map());
  const isMountedRef = useRef(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const onUpdateUsersCacheRef = useRef(onUpdateUsersCache);
  onUpdateUsersCacheRef.current = onUpdateUsersCache;

  const open = Boolean(anchorEl);
  const branchId = appStore((state) => state.selectedBranchState?.id);
  const currentUsedId = appStore((state) => state.authId);

  useEffect(() => {
    usersCacheRef.current = new Map(usersCache);
  }, [usersCache]);

  const fetchUsers = useCallback(
    async (query: string = '') => {
      if (!isMountedRef.current) return;

      try {
        setLoading(true);
        const options = {
          searchQuery: query,
          limit: 20,
          filterOptions: {
            branchId: branchId,
          },
          excludeDisabledUsers: true,
          isAttachment: true,
        };

        const response = await UsersApi.getListToChat(options, false);
        let usersData: IUser[] = [];

        const payload = response.data as IUser[] | { content?: IUser[] } | null | undefined;
        const rawList = Array.isArray(payload)
          ? payload
          : payload && typeof payload === 'object' && Array.isArray(payload.content)
            ? payload.content
            : [];

        usersData = rawList.filter((user) => user.id !== 2 && user.id !== currentUsedId);
        onUpdateUsersCacheRef.current(usersData);

        setUsers(usersData);
        setError('');
        hasLoadedRef.current = true;
      } catch (err) {
        setError(t('chat.usersFetchFailed'));
        hasLoadedRef.current = true;
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [branchId, t, currentUsedId],
  );

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      hasLoadedRef.current = false;
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const delayMs = searchQuery.length > 0 ? 300 : 0;
    searchTimeoutRef.current = setTimeout(() => {
      fetchUsers(searchQuery);
    }, delayMs);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [open, searchQuery, fetchUsers]);

  useEffect(() => {
    handleClose();
  }, [branchId]);

  useEffect(() => {
    // В React 18 Strict Mode после «фейкового» размонтирования ref сохраняет false —
    // без повторной установки true fetchUsers навсегда выходит по !isMountedRef.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (disabled) return;
    setAnchorEl(event.currentTarget);
    setIsBlurred(false);
  };

  const handleClose = () => {
    setAnchorEl(null);
    setSearchQuery('');
    setIsBlurred(true);
    onBlur();
  };

  const handleSelect = (userId: number) => {
    if (onCheckExistingSession && onCheckExistingSession(userId)) {
      handleClose();
      return;
    }

    const selectedUser =
      users.find((user) => user.id === userId) || usersCacheRef.current.get(userId);
    onUsersChange([userId]);
    if (onUserSelect && selectedUser) {
      onUserSelect(userId, selectedUser.fullName || getUserFullName(selectedUser), selectedUser);
    }
    handleClose();
  };

  const handleClearAll = (event: React.MouseEvent) => {
    if (disabled) return;
    event.stopPropagation();
    onUsersChange([]);
    if (onUserSelect) {
      onUserSelect(0, '', undefined);
    }
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    fetchUsers(searchQuery);
  };

  const getUserFullName = (user: IUser) => {
    return (
      user.fullName ||
      [user.firstName, user.middleName, user.surname].filter(Boolean).join(' ') ||
      t('chat.userWithId', { id: user.id })
    );
  };

  const getUserById = (userId: ID) => {
    const numericUserId = Number(userId);
    if (numericUserId === 0) return null;
    return usersCacheRef.current.get(numericUserId);
  };

  const getDisplayUserName = (userId: ID) => {
    if (displayUserName && displayUserName.trim() !== '') {
      return displayUserName;
    }

    const user = getUserById(userId);
    if (user) {
      return getUserFullName(user);
    }

    return `ID: ${userId}`;
  };

  const filteredSelectedUsers = selectedUsers.filter((id) => Number(id) !== 0);

  return (
    <FormControl fullWidth size="small" variant="outlined">
      <Box
        ref={selectRef}
        onClick={handleClick}
        sx={{
          border: '1px solid',
          borderColor: borderSubtle,
          borderRadius: '10px',
          padding: '16.5px 14px',
          minHeight: '40px',
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: surface,
          position: 'relative',
          '&:hover': {
            borderColor: disabled ? borderSubtle : borderHover,
          },
          opacity: disabled ? 0.7 : 1,
        }}>
        <Box
          component="span"
          sx={{
            position: 'absolute',
            top: '-6px',
            left: '8px',
            backgroundColor: surface,
            padding: '0 4px',
            fontSize: '0.75rem',
            color: theme.palette.text.secondary,
            fontWeight: 400,
            lineHeight: 1,
            zIndex: 1,
          }}>
          {t('chat.usersLabel')}
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, flex: 1, minHeight: '24px' }}>
          {filteredSelectedUsers.map((userId) => (
            <Chip
              key={userId}
              label={getDisplayUserName(userId)}
              size="small"
              sx={{
                backgroundColor: 'transparent',
                color: theme.palette.text.primary,
                fontWeight: 500,
                border: `1px solid ${borderSubtle}`,
              }}
            />
          ))}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', ml: 1 }}>
          {filteredSelectedUsers.length > 0 && !disabled && (
            <IconButton size="small" onClick={handleClearAll} sx={{ mr: 0.5 }}>
              <Close fontSize="small" />
            </IconButton>
          )}
          {!disabled && <ArrowDropDown />}
        </Box>
      </Box>

      {!disabled && (
        <Popover
          open={open}
          anchorEl={anchorEl}
          onClose={handleClose}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'left',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'left',
          }}
          sx={{ mt: 1 }}>
          <Box sx={{ width: selectRef.current?.clientWidth || 300, p: 1 }}>
            <form onSubmit={handleSearchSubmit}>
              <TextField
                inputRef={searchInputRef}
                autoFocus
                fullWidth
                size="small"
                placeholder={t('chat.searchUsersPlaceholder')}
                value={searchQuery}
                onChange={handleSearchChange}
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

            <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : error ? (
                <Box sx={{ p: 2, color: 'error.main' }}>{error}</Box>
              ) : users.length === 0 && hasLoadedRef.current ? (
                <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
                  {searchQuery ? t('chat.usersNotFound') : t('chat.noUsersAvailable')}
                </Box>
              ) : (
                users.map((user) => (
                  <MenuItem
                    key={user.id}
                    selected={filteredSelectedUsers.includes(user.id)}
                    onClick={() => handleSelect(user.id)}
                    sx={{
                      color: 'inherit',
                      backgroundColor: filteredSelectedUsers.includes(user.id)
                        ? isDark
                          ? 'rgba(144, 202, 249, 0.16)'
                          : '#e3f2fd'
                        : 'inherit',
                      '&:hover': {
                        backgroundColor: filteredSelectedUsers.includes(user.id)
                          ? isDark
                            ? 'rgba(144, 202, 249, 0.22)'
                            : '#bbdefb'
                          : theme.palette.action.hover,
                      },
                      '&.Mui-selected': {
                        backgroundColor: isDark ? 'rgba(144, 202, 249, 0.16)' : '#e3f2fd',
                        '&:hover': {
                          backgroundColor: isDark ? 'rgba(144, 202, 249, 0.22)' : '#bbdefb',
                        },
                      },
                    }}>
                    {getUserFullName(user)}
                  </MenuItem>
                ))
              )}
            </Box>
          </Box>
        </Popover>
      )}
    </FormControl>
  );
}

export default UsersSelect;
