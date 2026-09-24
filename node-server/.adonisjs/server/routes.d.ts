import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'login': { paramsTuple?: []; params?: {} }
    'auth.login': { paramsTuple?: []; params?: {} }
    'auth.guest': { paramsTuple?: []; params?: {} }
    'pending_approval.show': { paramsTuple?: []; params?: {} }
    'pending_approval.status': { paramsTuple?: []; params?: {} }
    'api_auth.token': { paramsTuple?: []; params?: {} }
    'api_auth.status': { paramsTuple?: []; params?: {} }
    'play': { paramsTuple?: []; params?: {} }
    'logout': { paramsTuple?: []; params?: {} }
    'api_auth.me': { paramsTuple?: []; params?: {} }
    'api_auth.logout': { paramsTuple?: []; params?: {} }
    'signal.store': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'signal.index': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'api_play.play': { paramsTuple?: []; params?: {} }
    'api_play.join': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'api_room.store': { paramsTuple?: []; params?: {} }
    'api_room.show': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'api_room.update': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'api_room.destroy': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'invite.room': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'invite.store': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'invite.players': { paramsTuple?: []; params?: {} }
    'invite.index': { paramsTuple?: []; params?: {} }
    'invite.accept': { paramsTuple: [ParamValue]; params: {'invite': ParamValue} }
    'invite.decline': { paramsTuple: [ParamValue]; params: {'invite': ParamValue} }
    'score.leaderboard': { paramsTuple?: []; params?: {} }
    'score.store': { paramsTuple?: []; params?: {} }
    'api_global_world.presence': { paramsTuple?: []; params?: {} }
    'api_game_rules': { paramsTuple?: []; params?: {} }
    'api_global_world.join': { paramsTuple?: []; params?: {} }
    'api_global_world.claim': { paramsTuple?: []; params?: {} }
    'api_global_world.leave': { paramsTuple?: []; params?: {} }
    'world.beacon': { paramsTuple?: []; params?: {} }
    'world.beacon_kind': { paramsTuple: [ParamValue]; params: {'kind': ParamValue} }
    'world.show': { paramsTuple?: [ParamValue?]; params?: {'kind'?: ParamValue} }
    'world.update': { paramsTuple?: [ParamValue?]; params?: {'kind'?: ParamValue} }
    'world.destroy': { paramsTuple?: [ParamValue?]; params?: {'kind'?: ParamValue} }
    'admin.index': { paramsTuple?: []; params?: {} }
    'login_window.show': { paramsTuple?: []; params?: {} }
    'login_window.update': { paramsTuple?: []; params?: {} }
    'admin_game_rules.show': { paramsTuple?: []; params?: {} }
    'admin_game_rules.update': { paramsTuple?: []; params?: {} }
    'device.index': { paramsTuple?: []; params?: {} }
    'device.approve': { paramsTuple: [ParamValue]; params: {'device': ParamValue} }
    'device.update': { paramsTuple: [ParamValue]; params: {'device': ParamValue} }
    'device.destroy': { paramsTuple: [ParamValue]; params: {'device': ParamValue} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.create': { paramsTuple?: []; params?: {} }
    'user.store': { paramsTuple?: []; params?: {} }
    'user.edit': { paramsTuple: [ParamValue]; params: {'user': ParamValue} }
    'user.update': { paramsTuple: [ParamValue]; params: {'user': ParamValue} }
    'user.destroy': { paramsTuple: [ParamValue]; params: {'user': ParamValue} }
    'user.reset_world': { paramsTuple: [ParamValue]; params: {'user': ParamValue} }
    'admin_global_world': { paramsTuple?: []; params?: {} }
    'admin_room.index': { paramsTuple?: []; params?: {} }
    'admin_room.destroy': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
  }
  GET: {
    'login': { paramsTuple?: []; params?: {} }
    'pending_approval.show': { paramsTuple?: []; params?: {} }
    'pending_approval.status': { paramsTuple?: []; params?: {} }
    'play': { paramsTuple?: []; params?: {} }
    'api_auth.me': { paramsTuple?: []; params?: {} }
    'signal.index': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'api_room.show': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'invite.room': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'invite.players': { paramsTuple?: []; params?: {} }
    'invite.index': { paramsTuple?: []; params?: {} }
    'score.leaderboard': { paramsTuple?: []; params?: {} }
    'api_global_world.presence': { paramsTuple?: []; params?: {} }
    'api_game_rules': { paramsTuple?: []; params?: {} }
    'world.show': { paramsTuple?: [ParamValue?]; params?: {'kind'?: ParamValue} }
    'admin.index': { paramsTuple?: []; params?: {} }
    'login_window.show': { paramsTuple?: []; params?: {} }
    'admin_game_rules.show': { paramsTuple?: []; params?: {} }
    'device.index': { paramsTuple?: []; params?: {} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.create': { paramsTuple?: []; params?: {} }
    'user.edit': { paramsTuple: [ParamValue]; params: {'user': ParamValue} }
    'admin_room.index': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'login': { paramsTuple?: []; params?: {} }
    'pending_approval.show': { paramsTuple?: []; params?: {} }
    'pending_approval.status': { paramsTuple?: []; params?: {} }
    'play': { paramsTuple?: []; params?: {} }
    'api_auth.me': { paramsTuple?: []; params?: {} }
    'signal.index': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'api_room.show': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'invite.room': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'invite.players': { paramsTuple?: []; params?: {} }
    'invite.index': { paramsTuple?: []; params?: {} }
    'score.leaderboard': { paramsTuple?: []; params?: {} }
    'api_global_world.presence': { paramsTuple?: []; params?: {} }
    'api_game_rules': { paramsTuple?: []; params?: {} }
    'world.show': { paramsTuple?: [ParamValue?]; params?: {'kind'?: ParamValue} }
    'admin.index': { paramsTuple?: []; params?: {} }
    'login_window.show': { paramsTuple?: []; params?: {} }
    'admin_game_rules.show': { paramsTuple?: []; params?: {} }
    'device.index': { paramsTuple?: []; params?: {} }
    'user.index': { paramsTuple?: []; params?: {} }
    'user.create': { paramsTuple?: []; params?: {} }
    'user.edit': { paramsTuple: [ParamValue]; params: {'user': ParamValue} }
    'admin_room.index': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'auth.login': { paramsTuple?: []; params?: {} }
    'auth.guest': { paramsTuple?: []; params?: {} }
    'api_auth.token': { paramsTuple?: []; params?: {} }
    'api_auth.status': { paramsTuple?: []; params?: {} }
    'logout': { paramsTuple?: []; params?: {} }
    'api_auth.logout': { paramsTuple?: []; params?: {} }
    'signal.store': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'api_play.play': { paramsTuple?: []; params?: {} }
    'api_play.join': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'api_room.store': { paramsTuple?: []; params?: {} }
    'invite.store': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'invite.accept': { paramsTuple: [ParamValue]; params: {'invite': ParamValue} }
    'invite.decline': { paramsTuple: [ParamValue]; params: {'invite': ParamValue} }
    'score.store': { paramsTuple?: []; params?: {} }
    'api_global_world.join': { paramsTuple?: []; params?: {} }
    'api_global_world.claim': { paramsTuple?: []; params?: {} }
    'api_global_world.leave': { paramsTuple?: []; params?: {} }
    'world.beacon': { paramsTuple?: []; params?: {} }
    'world.beacon_kind': { paramsTuple: [ParamValue]; params: {'kind': ParamValue} }
    'device.approve': { paramsTuple: [ParamValue]; params: {'device': ParamValue} }
    'user.store': { paramsTuple?: []; params?: {} }
  }
  PATCH: {
    'api_room.update': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'device.update': { paramsTuple: [ParamValue]; params: {'device': ParamValue} }
  }
  DELETE: {
    'api_room.destroy': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
    'world.destroy': { paramsTuple?: [ParamValue?]; params?: {'kind'?: ParamValue} }
    'device.destroy': { paramsTuple: [ParamValue]; params: {'device': ParamValue} }
    'user.destroy': { paramsTuple: [ParamValue]; params: {'user': ParamValue} }
    'user.reset_world': { paramsTuple: [ParamValue]; params: {'user': ParamValue} }
    'admin_global_world': { paramsTuple?: []; params?: {} }
    'admin_room.destroy': { paramsTuple: [ParamValue]; params: {'code': ParamValue} }
  }
  PUT: {
    'world.update': { paramsTuple?: [ParamValue?]; params?: {'kind'?: ParamValue} }
    'login_window.update': { paramsTuple?: []; params?: {} }
    'admin_game_rules.update': { paramsTuple?: []; params?: {} }
    'user.update': { paramsTuple: [ParamValue]; params: {'user': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}