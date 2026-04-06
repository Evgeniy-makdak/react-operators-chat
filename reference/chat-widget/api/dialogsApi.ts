/* eslint-disable @typescript-eslint/no-explicit-any */
import { deleteQuery, getQuery, postQuery } from '@shared/api/baseQueryTypes';
import { appStore } from '@shared/model/app_store/AppStore';
import { ID } from '@shared/types/BaseQueryTypes';

export interface Dialog {
  id: string;
  userId: number;
  clientName?: string;
  isAssigned?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TransferDialogData {
  dialogId: string;
  targetOperatorId: string;
}

export interface DialogOwner {
  id: number;
  email: string;
  firstName: string;
  surname: string;
  middleName: string;
  inProcessing: boolean;
  fullName: string;
}

export interface DialogBranch {
  id: number;
  name: string;
  parentOffice?: string;
  childOffices?: string[];
  createdAt?: string;
  createdBy?: DialogOwner;
  lastModifiedAt?: string;
  lastModifiedBy?: DialogOwner;
  systemGenerated?: boolean;
}

export interface UnreadDialog {
  id: number;
  branch: DialogBranch;
  status: string;
  owner: DialogOwner;
  createdAt: string;
  isActive: boolean;
  inactiveSince?: string;
  countUnreadMess?: number;
  countUnMessages?: number;
}

export interface DialogListResponse {
  content: UnreadDialog[];
  pageable: {
    sort: {
      empty: boolean;
      sorted: boolean;
      unsorted: boolean;
    };
    offset: number;
    pageNumber: number;
    pageSize: number;
    unpaged: boolean;
    paged: boolean;
  };
  last: boolean;
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  sort: {
    empty: boolean;
    sorted: boolean;
    unsorted: boolean;
  };
  first: boolean;
  numberOfElements: number;
  empty: boolean;
}

export interface UserMessagesResponse {
  content: any[];
  pageable: {
    sort: {
      empty: boolean;
      sorted: boolean;
      unsorted: boolean;
    };
    offset: number;
    pageNumber: number;
    pageSize: number;
    paged: boolean;
    unpaged: boolean;
  };
  last: boolean;
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
  sort: {
    empty: boolean;
    sorted: boolean;
    unsorted: boolean;
  };
  first: boolean;
  numberOfElements: number;
  empty: boolean;
}

export class DialogsApi {
  static assignDialog(userId: ID) {
    return postQuery<Dialog, unknown>({
      url: `api/v1/dialogs/${userId}/assign`,
      data: {},
    });
  }

  static completeDialog(dialogId: string) {
    return postQuery<Dialog, unknown>({
      url: `api/v1/dialogs/${dialogId}/complete`,
      data: {},
    });
  }

  static transferDialog(transferData: TransferDialogData) {
    return postQuery<Dialog, TransferDialogData>({
      url: 'api/v1/dialogs/transfer',
      data: transferData,
    });
  }

  static deleteDialog(dialogId: string) {
    return deleteQuery({
      url: `api/v1/dialogs/${dialogId}`,
    });
  }

  static getAllDialogs() {
    return getQuery<Dialog[]>({
      url: 'api/v1/dialogs',
    });
  }

  static createDialog(dialogData: any) {
    return postQuery<Dialog, any>({
      url: 'api/v1/dialogs',
      data: dialogData,
    });
  }

  static getDialogById(dialogId: string) {
    return getQuery<Dialog>({
      url: `api/v1/dialogs/${dialogId}`,
    });
  }

  static getDialogsCount() {
    return getQuery<{ count: number }>({
      url: 'api/v1/dialogs/count',
    });
  }

  static getUnreadDialogs() {
    const currentBranchId = appStore.getState().selectedBranchState?.id;

    if (!currentBranchId) {
      console.warn('BranchId не установлен, загружаем диалоги без фильтра по филиалу');
      return getQuery<DialogListResponse>({
        url: 'api/v1/dialogs?all.countMessages.equals=true&all.status.in=ACTIVE,CLOSED',
      });
    }

    return getQuery<DialogListResponse>({
      url: `api/v1/dialogs?all.countMessages.equals=true&all.branch.id.in=${currentBranchId}&all.status.in=ACTIVE,CLOSED`,
    });
  }

  static getMessages(
    params: {
      dialogId?: string;
      userId?: number;
      page?: number;
      size?: number;
      sort?: string;
    } = {},
  ) {
    const { dialogId, userId, page = 0, size = 20, sort = 'createdAt,desc' } = params;
    const queryParams: string[] = [];

    if (dialogId) queryParams.push(`all.dialog.id.equals=${dialogId}`);
    if (userId) queryParams.push(`all.dialog.owner.id.equals=${userId}`);
    if (page !== undefined) queryParams.push(`page=${page}`);
    if (size !== undefined) queryParams.push(`size=${size}`);
    if (sort) queryParams.push(`sort=${sort}`);

    const url = `api/v1/messages?${queryParams.join('&')}`;
    return getQuery<any>({ url });
  }

  static getDialogDetails(dialogId: string) {
    return this.getMessages({ dialogId });
  }

  static getUserMessages(userId: number, page = 0, size = 20) {
    return this.getMessages({ userId, page, size });
  }

  static getDialogMessagesInfo(dialogId: string) {
    return this.getMessages({ dialogId, page: 0, size: 1 });
  }
}
