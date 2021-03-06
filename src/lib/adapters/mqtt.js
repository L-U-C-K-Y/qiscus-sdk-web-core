import { match, when } from '../match'
import mitt from 'mitt'
import connect from 'mqtt/lib/connect'
import request from 'superagent'
import debounce from 'lodash.debounce'
import { wrapP } from '../util'

export default class MqttAdapter {
  /**
   * @typedef {Function} GetClientId
   * @return {string}
   */
  /**
   * @typedef {Object} MqttAdapterParams
   * @property {boolean} shouldConnect
   * @property {string} brokerLbUrl
   * @property {boolean} enableLb
   * @property {GetClientId} getClientId
   */
  /**
   * @param {string} url
   * @param {QiscusSDK} core
   * @param {boolean} login
   * @param {MqttAdapterParams} obj
   */
  constructor(url, core, login, { shouldConnect = true, brokerLbUrl, enableLb, getClientId }) {
    const emitter = mitt()

    const _getClientId = () => {
      if (getClientId == null) return `${core.AppId}_${core.user_id}_${Date.now()}`
      return getClientId()
    }

    const matcher = match({
      [when(this.reNewMessage)]: (topic) =>
        this.newMessageHandler.bind(this, topic),
      [when(this.reNotification)]: (topic) =>
        this.notificationHandler.bind(this, topic),
      [when(this.reTyping)]: (topic) => this.typingHandler.bind(this, topic),
      [when(this.reDelivery)]: (topic) =>
        this.deliveryReceiptHandler.bind(this, topic),
      [when(this.reRead)]: (topic) => this.readReceiptHandler.bind(this, topic),
      [when(this.reOnlineStatus)]: (topic) =>
        this.onlinePresenceHandler.bind(this, topic),
      [when(this.reChannelMessage)]: (topic) =>
        this.channelMessageHandler.bind(this, topic),
      [when()]: (topic) => this.logger('topic not handled', topic),
    })

    const __mqtt_connected_handler = () => {
      emitter.emit('connected')
    }
    const __mqtt_reconnect_handler = () => {
      emitter.emit('reconnect')
    }
    const __mqtt_closed_handler = (...args) => {
      emitter.emit('close', args)
    }
    const __mqtt_message_handler = (t, m) => {
      const message = m.toString()
      const func = matcher(t)
      this.logger('message', t, m)
      if (func != null) func(message)
    }
    const __mqtt_error_handler = (err) => {
      if (err && err.message === 'client disconnecting') return
      emitter.emit('error', err.message)
      this.logger('error', err.message)
    }
    const __mqtt_conneck = (brokerUrl) => {
      const topics = []

      if (brokerUrl == null) brokerUrl = this.cacheRealtimeURL
      if (this.mqtt != null) {
        const _topics = Object.keys(this.mqtt._resubscribeTopics)
        topics.push(..._topics)

        this.mqtt.removeAllListeners()
        this.mqtt = null
      }
      const opts = {
        will: {
          topic: `u/${core.user_id}/s`,
          payload: 0,
          retain: true,
        },
        clientId: _getClientId()
      }

      const mqtt = connect(brokerUrl, opts)

      // #region Mqtt Listener
      mqtt.addListener('connect', __mqtt_connected_handler)
      mqtt.addListener('reconnect', __mqtt_reconnect_handler)
      mqtt.addListener('close', __mqtt_closed_handler)
      mqtt.addListener('error', __mqtt_error_handler)
      mqtt.addListener('message', __mqtt_message_handler)
      // #endregion

      topics.forEach((topic) => mqtt.subscribe(topic))

      return mqtt
    }

    this.__mqtt_conneck = __mqtt_conneck
    this.__url = url
    let mqtt = __mqtt_conneck(url)

    // if appConfig set realtimeEnabled to false,
    // we intentionally end mqtt connection here.
    // TODO: Make a better way to not connect
    //       to broker, but still having mqtt client initiated.
    if (!shouldConnect) mqtt.end(true);

    this.willConnectToRealtime = false
    this.cacheRealtimeURL = url
    // Define a read-only property so user cannot accidentially
    // overwrite it's value
    Object.defineProperties(this, {
      core: { value: core },
      emitter: { value: emitter },
      mqtt: { value: mqtt, writable: true },
      brokerLbUrl: { value: brokerLbUrl },
    })

    // handle load balencer
    emitter.on(
      'close',
      debounce(async () => {
        if (enableLb == null) return
        if (login != null && login == false) return
        if (shouldConnect == false) return
        this.willConnectToRealtime = true

        const [url, err] = await wrapP(this.getMqttNode())
        if (err) {
          this.logger(
            `cannot get new brokerURL, using old url instead (${this.cacheRealtimeURL})`
          )
          this.mqtt = __mqtt_conneck(this.cacheRealtimeURL)
        } else {
          this.cacheRealtimeURL = url
          this.logger('trying to reconnect to', url)
          this.mqtt = __mqtt_conneck(url)
        }
        this.logger(`resubscribe to old topics ${topics}`)
      }, 300)
    )
  }

  connect() {
    this.mqtt = this.__mqtt_conneck()
  }

  async getMqttNode() {
    const res = await request.get(this.brokerLbUrl)
    const url = res.body.data.url
    const port = res.body.data.wss_port
    return `wss://${url}:${port}/mqtt`
  }

  get connected() {
    if (this.mqtt == null) return false
    return this.mqtt.connected
  }

  subscribtionBuffer = []
  subscribe(...args) {
    this.logger('subscribe to', args)
    this.subscribtionBuffer.push(args)
    if (this.mqtt != null) {
      do {
        const subs = this.subscribtionBuffer.shift()
        if (subs != null) this.mqtt.subscribe(...args)
      } while (this.subscribtionBuffer.length > 0)
    }
  }

  unsubscribtionBuffer = []
  unsubscribe(...args) {
    this.logger('unsubscribe from', args)
    this.unsubscribtionBuffer.push(args)
    if (this.mqtt != null) {
      do {
        const subs = this.unsubscribtionBuffer.shift()
        if (subs != null) {
          this.mqtt.unsubscribe(...subs)
        }
      } while (this.unsubscribtionBuffer.length > 0)
    }
  }

  publishBuffer = []
  publish(topic, payload, options = {}) {
    this.publishBuffer.push({ topic, payload, options })
    do {
      const data = this.publishBuffer.shift()
      if (data != null) {
        return this.mqtt.publish(
          data.topic,
          data.payload.toString(),
          data.options
        )
      }
    } while (this.publishBuffer.length > 0)
  }

  emit(...args) {
    this.emitter.emit(...args)
  }

  on(...args) {
    this.emitter.on(...args)
  }

  get logger() {
    if (!this.core.debugMQTTMode) return this.noop
    return console.log.bind(console, 'QRealtime ->')
  }

  // #region regexp
  get reNewMessage() {
    return /^(.+)\/c$/i
  }
  get reNotification() {
    return /^(.+)\/n$/i
  }
  get reTyping() {
    return /^r\/([\d]+)\/([\d]+)\/(.+)\/t$/i
  }
  get reDelivery() {
    return /^r\/([\d]+)\/([\d]+)\/(.+)\/d$/i
  }
  get reRead() {
    return /^r\/([\d]+)\/([\d]+)\/(.+)\/r$/i
  }
  get reOnlineStatus() {
    return /^u\/(.+)\/s$/i
  }
  get reChannelMessage() {
    return /^(.+)\/(.+)\/c$/i
  }
  // #endregion

  noop() { }

  newMessageHandler(topic, message) {
    message = JSON.parse(message)
    this.logger('on:new-message', message)
    this.emit('new-message', message)
  }

  notificationHandler(topic, message) {
    this.logger('on:notification', message)
    message = JSON.parse(message)
    const data = message.payload.data
    if ('deleted_messages' in data) {
      data.deleted_messages.forEach((message) => {
        this.emit('comment-deleted', {
          roomId: message.room_id,
          commentUniqueIds: message.message_unique_ids,
          isForEveryone: true,
          isHard: true,
        })
      })
    }

    if ('deleted_rooms' in data) {
      data.deleted_rooms.forEach((room) => {
        this.emit('room-cleared', room)
      })
    }
  }

  typingHandler(t, message) {
    this.logger('on:typing', t)
    // r/{roomId}/{roomId}/{userId}/t
    const topic = t.match(this.reTyping)
    if (topic[3] === this.core.user_id) return

    const userId = topic[3]
    const roomId = topic[1]

    this.emit('typing', {
      message,
      userId,
      roomId,
    })

    // TODO: Don't allow side-effect
    // it should be handled in the UI not core
    if (this.core.selected == null) return
    if (message === '1' && roomId === this.core.selected.id) {
      const actor = this.core.selected.participants.find(
        (it) => it.email === userId
      )
      if (actor == null) return
      const displayName = actor.username
      this.core.isTypingStatus = `${displayName} is typing ...`
    } else {
      this.core.isTypingStatus = null
    }
  }

  deliveryReceiptHandler(t, message) {
    this.logger('on:delivered', t, message)
    // r/{roomId}/{roomId}/{userId}/d
    const topic = t.match(this.reDelivery)
    const data = message.split(':')
    const commentId = Number(data[0])
    const commentUniqueId = data[1]
    const userId = topic[3]

    this.emit('message-delivered', {
      commentId,
      commentUniqueId,
      userId,
    })
  }

  readReceiptHandler(t, message) {
    this.logger('on:read', t, message)
    // r/{roomId}/{roomId}/{userId}/r
    const topic = t.match(this.reRead)
    const data = message.split(':')
    const commentId = Number(data[0])
    const commentUniqueId = data[1]
    const userId = topic[3]

    this.emit('message-read', {
      commentId,
      commentUniqueId,
      userId,
    })
  }

  onlinePresenceHandler(topic, message) {
    this.logger('on:online-presence', topic, message)
    // u/guest-1002/s
    const topicData = this.reOnlineStatus.exec(topic)
    const userId = topicData[1]

    this.emit('presence', { message, userId })
  }

  channelMessageHandler(topic, message) {
    this.logger('on:channel-message', topic, message)
    this.emit('new-message', JSON.parse(message))
  }

  // #region old-methods
  subscribeChannel(appId, uniqueId) {
    this.subscribe(`${appId}/${uniqueId}/c`)
  }

  subscribeRoom(roomId) {
    if (this.core.selected == null) return
    roomId = roomId || this.core.selected.id
    this.subscribe(`r/${roomId}/${roomId}/+/t`)
    this.subscribe(`r/${roomId}/${roomId}/+/d`)
    this.subscribe(`r/${roomId}/${roomId}/+/r`)
  }

  unsubscribeRoom(roomId) {
    if (this.core.selected == null) return
    roomId = roomId || this.core.selected.id
    this.unsubscribe(`r/${roomId}/${roomId}/+/t`)
    this.unsubscribe(`r/${roomId}/${roomId}/+/d`)
    this.unsubscribe(`r/${roomId}/${roomId}/+/r`)
  }

  get subscribeTyping() {
    return this.subscribeRoom.bind(this)
  }

  get unsubscribeTyping() {
    return this.unsubscribeRoom.bind(this)
  }

  subscribeUserChannel() {
    this.subscribe(`${this.core.userData.token}/c`)
    this.subscribe(`${this.core.userData.token}/n`)
  }

  publishPresence(userId, isOnline = true) {
    isOnline
      ? this.publish(`u/${userId}/s`, 1, { retain: true })
      : this.publish(`u/${userId}/s`, 0, { retain: true })
  }

  disconnect() {
    this.publishPresence(this.core.userData.email, false),
      this.unsubscribe(Object.keys(this.mqtt._resubscribeTopics))
  }

  subscribeUserPresence(userId) {
    this.subscribe(`u/${userId}/s`)
  }

  unsubscribeUserPresence(userId) {
    this.unsubscribe(`u/${userId}/s`)
  }

  get subscribeRoomPresence() {
    return this.subscribeUserPresence.bind(this)
  }

  get unsubscribeRoomPresence() {
    return this.unsubscribeUserPresence.bind(this)
  }

  publishTyping(status) {
    if (this.core.selected == null) return
    const roomId = this.core.selected.id
    const userId = this.core.user_id
    this.publish(`r/${roomId}/${roomId}/${userId}/t`, status)
  }

  // #endregion
}
