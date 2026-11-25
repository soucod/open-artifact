// A ten-line guard: nobody downloads an artifact's archive; the person reads why. Its `ui` brands the site and adds a
// link to the account menu and one to the home page.
export default {
  id: 'no-export',
  apiVersion: 1,
  guard({ action }) {
    if (action === 'artifact.export') return { deny: 'Downloads are turned off on this site; ask an administrator.' };
  },
  ui: { brand: { name: 'Acme Artifacts' }, links: [{ label: 'Help desk', href: 'https://help.example.com/', where: 'account-menu' }, { label: 'Site policy', href: 'https://policy.example.com/', where: 'home' }] },
};
