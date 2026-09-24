import { DateTime } from 'luxon'
import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/** Promote an existing player to admin from the shell. */
export default class MakeAdmin extends BaseCommand {
  static commandName = 'user:make-admin'
  static description = 'Give an existing user admin rights and approve their devices'
  static options: CommandOptions = { startApp: true }

  @args.string({ description: 'the account to promote' })
  declare email: string

  async run() {
    const { default: User } = await import('#models/user')
    const { default: Device } = await import('#models/device')
    const user = await User.findBy('email', this.email)
    if (!user) {
      this.logger.error(`No user with email ${this.email}.`)
      this.exitCode = 1
      return
    }

    user.merge({ isAdmin: true, isDisabled: false })
    await user.save()
    // admins bypass approval anyway; approving keeps the device list honest
    await Device.query()
      .where('user_id', user.id)
      .whereNull('approved_at')
      .update({ approved_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'), approved_by: user.id })
    this.logger.success(`${user.email} is now an admin.`)
  }
}
