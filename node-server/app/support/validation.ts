import { errors } from '@vinejs/vine'

/**
 * Refuse the request as a validation failure on one field, like Laravel's
 * `ValidationException::withMessages`: a form gets the message under that field, a
 * JSON caller a 422 with `{ message, errors }`.
 */
export function failValidation(field: string, message: string): never {
  throw new errors.E_VALIDATION_ERROR([{ field, message, rule: 'custom' }])
}
