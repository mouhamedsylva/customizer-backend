import { contenuConforme } from '../src/uploads/type-fichier';

/** Le type MIME vient du client : le contenu doit le confirmer. */
describe('contenuConforme', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pdf = Buffer.from('%PDF-1.7\n');
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // « MZ » : exécutable Windows

  it('reconnaît les formats acceptés', () => {
    expect(contenuConforme(png, 'image/png')).toBe(true);
    expect(contenuConforme(pdf, 'application/pdf')).toBe(true);
    expect(contenuConforme(Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    expect(contenuConforme(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="x"/>'), 'image/svg+xml')).toBe(true);
    expect(contenuConforme(Buffer.from('Bonjour'), 'text/plain')).toBe(true);
  });

  it('refuse un contenu déguisé', () => {
    expect(contenuConforme(exe, 'image/png')).toBe(false);
    expect(contenuConforme(exe, 'application/pdf')).toBe(false);
    expect(contenuConforme(Buffer.from('<html><script>'), 'image/svg+xml')).toBe(false);
    expect(contenuConforme(exe, 'text/plain')).toBe(false);
    expect(contenuConforme(png, 'application/x-msdownload')).toBe(false);
  });
});
