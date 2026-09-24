/**
 * The pages the server renders (inertia/Pages). Their props are typed in the page
 * components themselves, which the Laravel app renders too, so here every page takes
 * plain JSON props.
 */
export {}

declare module '@adonisjs/inertia/types' {
  interface InertiaPages {
    'Login': ComponentProps
    'PendingApproval': ComponentProps
    'Play': ComponentProps
    'Admin/Dashboard': ComponentProps
    'Admin/Devices': ComponentProps
    'Admin/Hours': ComponentProps
    'Admin/Rooms': ComponentProps
    'Admin/Rules': ComponentProps
    'Admin/UserForm': ComponentProps
    'Admin/Users': ComponentProps
  }
}
