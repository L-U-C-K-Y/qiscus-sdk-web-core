
import test from 'ava'
import Qiscus from './main'

test('QiscusSDK should have all the required method', t => {
  t.truthy(Qiscus.instance);
  t.truthy(Qiscus.instance.setup);
  t.truthy(Qiscus.instance.setupWithCustomServer);
  t.truthy(Qiscus.instance.setUser);
  t.truthy(Qiscus.instance.setUserWithIdentityToken);
  t.truthy(Qiscus.instance.chatUser);
  t.truthy(Qiscus.instance.createGroupChat);
  t.truthy(Qiscus.instance.createChannel);
  t.truthy(Qiscus.instance.getChannel);
  t.truthy(Qiscus.instance.sendMessage);
  t.truthy(Qiscus.instance.upload);
  t.truthy(Qiscus.instance.updateChatRoom);
  t.truthy(Qiscus.instance.markAsRead);
  t.truthy(Qiscus.instance.registerDeviceToken);
  t.truthy(Qiscus.instance.removeDeviceToken);
  t.truthy(Qiscus.instance.getJWTNonce);
  t.truthy(Qiscus.instance.blockUser);
  t.truthy(Qiscus.instance.unblockUser);
  t.truthy(Qiscus.instance.addParticipants);
  t.truthy(Qiscus.instance.removeParticipants);
  t.truthy(Qiscus.instance.getBlockedUsers);
  t.truthy(Qiscus.instance.getPreviouseMessagesById);
  t.truthy(Qiscus.instance.getNextMessagesById);
  t.truthy(Qiscus.instance.synchronize);
  t.truthy(Qiscus.instance.getChatRoomWithMessages);
  t.truthy(Qiscus.instance.getChatRooms);
  t.truthy(Qiscus.instance.getUserData);
  t.truthy(Qiscus.instance.getAllChatRooms);
  t.truthy(Qiscus.instance.synchronizeEvent);
  t.truthy(Qiscus.instance.getParticipants);
  t.truthy(Qiscus.instance.getTotalUnreadCount);
  t.truthy(Qiscus.instance.updateUser);
  t.truthy(Qiscus.instance.deleteMessages);
  t.truthy(Qiscus.instance.clearMessagesByChatRoomId);
  t.truthy(Qiscus.instance.getUsers);
  t.truthy(Qiscus.instance.setSyncInterval);
  t.truthy(Qiscus.instance.subscribeEvent);
  t.truthy(Qiscus.instance.publishEvent)
});
