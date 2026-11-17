/** A business-rule failure with a message that is safe to show to staff. */
export class DomainError extends Error {}

/** The current password was wrong. Counts against the password-check limit (other errors do not). */
export class WrongPasswordError extends DomainError {}
