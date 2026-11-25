/**
 * The app origin (decision 19): the home page, the Shell, the Library API, sharing and share links, platform-neutral.
 * A platform gives it {@link AppServices}; `createAppHandler` is the whole origin as one Fetch handler.
 */
export * from './services.ts';
export * from './security.ts';
export * from './views.ts';
export * from './pages.ts';
export * from './library.ts';
export * from './share.ts';
export * from './stream.ts';
export * from './routes.ts';
export * from './error-page.ts';
export * from './audit.ts';
