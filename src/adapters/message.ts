import cuid from 'cuid'
import {
  IQMessage,
  IQMessageAdapter,
  IQMessageStatus,
  IQMessageT,
  IQMessageType,
  IQRoomAdapter,
  IQUserAdapter
} from '../defs'
import QUrlBuilder from '../utils/url-builder'
import { IQHttpAdapter } from './http'

export const getMessageType = (type: string) => {
  switch (type) {
    case 'custom':
      return IQMessageType.Custom;
    case 'text':
    default:
      return IQMessageType.Text
  }
};

export class QMessage implements IQMessage {
  id: number;
  content: string;
  previousMessageId: number;
  roomId: number;
  status: IQMessageStatus;
  timestamp: Date;
  type: IQMessageType;
  userId: string;
  uniqueId: string;
  extras: object;
  payload: object;

  updateFromJson (json: PostCommentResponse.Comment): IQMessage {
    this.id = json.id;
    this.content = json.message;
    this.previousMessageId = json.comment_before_id;
    this.roomId = json.room_id;
    this.timestamp = new Date(json.timestamp);
    this.userId = json.username;
    this.uniqueId = json.unique_temp_id;
    this.extras = json.extras;
    this.payload = json.payload;
    if (json.type === 'text') this.type = IQMessageType.Text;
    if (json.type === 'custom') this.type = IQMessageType.Custom;
    if (json.status === 'delivered') this.status = IQMessageStatus.Delivered;
    if (json.status === 'read') this.status = IQMessageStatus.Read;
    return this
  }

  static fromJson (json: PostCommentResponse.Comment): IQMessage {
    return new QMessage().updateFromJson(json)
  }

  static prepareNew (userId: string, roomId: number, content: string, type = IQMessageType.Text, extras: object = {}, payload: object = {}): IQMessage {
    const timestamp = new Date();
    const message = new QMessage();
    message.content = content;
    message.type = type;
    message.status = IQMessageStatus.Sending;
    message.roomId = roomId;
    message.timestamp = timestamp;
    message.userId = userId;
    message.uniqueId = `js-${cuid()}`;
    message.extras = extras;
    message.payload = payload;
    return message
  }
}

export default function getMessageAdapter (
  http: IQHttpAdapter,
  user: IQUserAdapter,
  roomAdapter: IQRoomAdapter
): IQMessageAdapter {
  let messageStore: Map<string, IQMessage> = new Map();
  return {
    get messages () { return messageStore },
    sendMessage (roomId: number, messageT: IQMessageT): Promise<IQMessage> {
      const message = QMessage.prepareNew(user.currentUser.userId, roomId, messageT.message);
      messageStore.set(message.uniqueId, message);
      const url = QUrlBuilder('post_comment')
        .param('token', user.token)
        .param('topic_id', message.roomId)
        .param('message', message.content)
        .param('extras', message.extras)
        .build();
      return http.get<PostCommentResponse.RootObject>(url)
        .then(resp => resp.results.comment)
        .then<IQMessage>((comment) => {
          message.updateFromJson(comment);
          messageStore.set(message.uniqueId, message);
          return message
        })
    },
    getMessages (roomId: number, lastMessageId: number = 0, limit: number = 20, after: boolean = false): Promise<IQMessage[]> {
      const url = QUrlBuilder('load_comments')
        .param('token', user.token)
        .param('topic_id', roomId)
        .param('last_comment_id', lastMessageId)
        .param('limit', limit)
        .param('after', after)
        .build();
      return http.get<GetCommentsResponse.RootObject>(url)
        .then(res => res.results.comments)
        .then((comments) => {
          const _messages = comments.map<IQMessage>((comment) => QMessage.fromJson(comment));
          for (let message of _messages) {
            messageStore.set(message.uniqueId, message)
          }
          return _messages
        })
    },
    deleteMessage (messageUniqueIds: string[]): Promise<IQMessage[]> {
      const url = QUrlBuilder('delete_messages')
        .param('token', user.token)
        .param('unique_ids[]', messageUniqueIds)
        .build();
      return http.delete<DeleteCommentsResponse.RootObject>(url)
        .then<IQMessage[]>((resp) => {
          return resp.results.comments
            .map<IQMessage>((comment) => {
              if (messageStore.has(comment.unique_temp_id)) {
                const message = messageStore.get(comment.unique_temp_id);
                messageStore.delete(comment.unique_temp_id);
                return message
              } else {
                return QMessage.fromJson(comment)
              }
            })
        })
    },
    markAsRead (roomId: number, messageId: number): Promise<IQMessage> {
      const url = QUrlBuilder('update_comment_status')
        .param('token', user.token)
        .param('last_comment_read_id', messageId)
        .param('room_id', roomId)
        .build();
      return http.post<UpdateCommentStatusResponse.RootObject>(url)
        .then(resp => resp.results)
        .then((result) => {
          if (roomAdapter.rooms.has(roomId)) {
            const room = roomAdapter.rooms.get(roomId);
            const userId = result.user_id;
            const messageId = result.last_comment_read_id;
            // Logic here:
            // If all participants has the same last read id
            // then update message object as read
            // otherwise, don't change message object
            //
            // First we update participants last read id
            const targetedParticipant = room.participants.find(it => it.id === userId);
            targetedParticipant.lastReadMessageId = messageId;
            const hasRead = room.participants.map(it => it.lastReadMessageId)
              .every((lastId) => {
                return lastId >= messageId
              });
            if (hasRead) {
            }
          }
          const userId = result.user_id;
          const messageId = result.last_comment_read_id;
          const message = Array.from(messageStore.values()).find(it => it.id === messageId);
          // TODO: Make me as read if all participants has read it
          message.status = IQMessageStatus.Read;
          return message
        })
    },
    markAsDelivered (roomId: number, messageId: number): Promise<IQMessage> {
      const url = QUrlBuilder('update_comment_status')
        .param('token', user.token)
        .param('last_comment_received_id', messageId)
        .param('room_id', roomId)
        .build();
      return http.post<UpdateCommentStatusResponse.RootObject>(url)
        .then(resp => resp.results)
        .then((result) => {
          return null
        })
    }
  }
}

// Response type
export declare module PostCommentResponse {
  export interface Avatar {
    url: string;
  }

  export interface UserAvatar {
    avatar: Avatar;
  }

  export interface Comment {
    comment_before_id: number;
    comment_before_id_str: string;
    disable_link_preview: boolean;
    email: string;
    extras: object;
    id: number;
    id_str: string;
    is_deleted: boolean;
    is_public_channel: boolean;
    message: string;
    payload: object;
    room_avatar: string;
    room_id: number;
    room_id_str: string;
    room_name: string;
    room_type: string;
    status: string;
    timestamp: Date;
    topic_id: number;
    topic_id_str: string;
    type: string;
    unique_temp_id: string;
    unix_nano_timestamp: number;
    unix_timestamp: number;
    user_avatar: UserAvatar;
    user_avatar_url: string;
    user_id: number;
    user_id_str: string;
    username: string;
  }

  export interface Results {
    comment: Comment;
  }

  export interface RootObject {
    results: Results;
    status: number;
  }
}
export declare module GetCommentsResponse {

  export interface Extras {
  }

  export interface Payload {
  }

  export interface Avatar {
    url: string;
  }

  export interface UserAvatar {
    avatar: Avatar;
  }

  export interface Comment {
    comment_before_id: number;
    comment_before_id_str: string;
    disable_link_preview: boolean;
    email: string;
    extras: Extras;
    id: number;
    id_str: string;
    is_deleted: boolean;
    is_public_channel: boolean;
    message: string;
    payload: Payload;
    room_avatar: string;
    room_id: number;
    room_id_str: string;
    room_name: string;
    room_type: string;
    status: string;
    timestamp: Date;
    topic_id: number;
    topic_id_str: string;
    type: string;
    unique_temp_id: string;
    unix_nano_timestamp: number;
    unix_timestamp: number;
    user_avatar: UserAvatar;
    user_avatar_url: string;
    user_id: number;
    user_id_str: string;
    username: string;
  }

  export interface Results {
    comments: Comment[];
  }

  export interface RootObject {
    results: Results;
    status: number;
  }

}
export declare module DeleteCommentsResponse {

  export interface Extras {
  }

  export interface Payload {
  }

  export interface Avatar {
    url: string;
  }

  export interface UserAvatar {
    avatar: Avatar;
  }

  export interface Comment {
    comment_before_id: number;
    comment_before_id_str: string;
    disable_link_preview: boolean;
    email: string;
    extras: Extras;
    id: number;
    id_str: string;
    is_deleted: boolean;
    is_public_channel: boolean;
    message: string;
    payload: Payload;
    room_avatar: string;
    room_id: number;
    room_id_str: string;
    room_name: string;
    room_type: string;
    status: string;
    timestamp: Date;
    topic_id: number;
    topic_id_str: string;
    type: string;
    unique_temp_id: string;
    unix_nano_timestamp: any;
    unix_timestamp: number;
    user_avatar: UserAvatar;
    user_avatar_url: string;
    user_id: number;
    user_id_str: string;
    username: string;
  }

  export interface Results {
    comments: Comment[];
  }

  export interface RootObject {
    results: Results;
    status: number;
  }

}
export declare module UpdateCommentStatusResponse {

  export interface Results {
    changed: boolean;
    last_comment_read_id: number;
    last_comment_read_id_str: string;
    last_comment_received_id: number;
    last_comment_received_id_str: string;
    user_id: number;
    user_id_str: string;
  }

  export interface RootObject {
    results: Results;
    status: number;
  }

}
