import { errors } from '@vinejs/vine';
export function failValidation(field, message) {
    throw new errors.E_VALIDATION_ERROR([{ field, message, rule: 'custom' }]);
}
//# sourceMappingURL=validation.js.map