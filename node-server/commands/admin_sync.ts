import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import adminConfig from '#config/admin'

/**
 * Creates or updates the admin account named in .env (ADMIN_EMAIL / ADMIN_PASSWORD /
 * ADMIN_NAME) and marks it as admin. Idempotent; run it after migrations on every
 * deploy so a fresh install always has one admin who can approve devices.
 */
export default class AdminSync extends BaseCommand {
  static commandName = 'admin:sync'
  static description = 'Create or update the admin user from ADMIN_EMAIL / ADMIN_PASSWORD in .env'
  static options: CommandOptions = { startApp: true }

  async run() {
    const { default: User } = await import('#models/user')
    const { email, password } = adminConfig
    if (email === '') {
      this.logger.warning('ADMIN_EMAIL is not set; nothing to do.')
      return
    }

    let user = await User.findBy('email', email)
    if (!user && password === '') {
      this.logger.error(`No user with email ${email} and ADMIN_PASSWORD is empty, so it cannot be created.`)
      this.exitCode = 1
      return
    }

    if (!user) user = new User().merge({ email, name: await this.uniqueName(adminConfig.name) })
    user.merge({ isAdmin: true, isDisabled: false })
    if (password !== '') user.password = password
    await user.save()
    this.logger.success(`${user.email} is an admin${password !== '' ? ' (password set from .env).' : '.'}`)
  }

  /** player names are unique; fall back to "Admin 2" if a player already took "Admin" */
  private async uniqueName(base: string): Promise<string> {
    const { default: User } = await import('#models/user')
    const stem = (base !== '' ? base : 'Admin').slice(0, 14)
    let name = stem
    for (let i = 2; await User.findBy('name', name); i++) name = `${stem} ${i}`
    return name
  }
}
