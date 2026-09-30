import { optionsPieceJointe, ressourceDepuisUrl } from './piece-jointe-cloudinary';

describe('pièces jointes de facture sur Cloudinary', () => {
  const T = 1759200000000;

  it('garde un PDF en document (raw) avec son extension', () => {
    expect(optionsPieceJointe('Synthèse du projet.pdf', 'application/pdf', T)).toEqual({
      resourceType: 'raw',
      publicId: `Synth-se-du-projet_${T}.pdf`,
    });
  });

  it('garde DOCX et XLSX en raw avec leur extension', () => {
    expect(
      optionsPieceJointe(
        'devis.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        T,
      ).publicId,
    ).toBe(`devis_${T}.docx`);
    expect(optionsPieceJointe('Tarifs.XLSX', 'application/vnd.ms-excel', T)).toEqual({
      resourceType: 'raw',
      publicId: `Tarifs_${T}.xlsx`,
    });
  });

  it('déduit l’extension du type si le nom n’en a pas', () => {
    expect(optionsPieceJointe('contrat', 'application/pdf', T).publicId).toBe(`contrat_${T}.pdf`);
  });

  it('laisse une image en image, sans extension', () => {
    expect(optionsPieceJointe('logo.png', 'image/png', T)).toEqual({
      resourceType: 'image',
      publicId: `logo_${T}`,
    });
  });

  it('retrouve public_id et type depuis l’URL, pour le nettoyage', () => {
    expect(
      ressourceDepuisUrl('https://res.cloudinary.com/demo/raw/upload/v17/customizer/temp-attachments/devis_1.pdf'),
    ).toEqual({ publicId: 'customizer/temp-attachments/devis_1.pdf', resourceType: 'raw' });
    // Ancien upload « auto » : le PDF rangé parmi les images.
    expect(
      ressourceDepuisUrl('https://res.cloudinary.com/demo/image/upload/v17/customizer/temp-attachments/devis_1.pdf'),
    ).toEqual({ publicId: 'customizer/temp-attachments/devis_1', resourceType: 'image' });
    expect(ressourceDepuisUrl('https://exemple.com/x.pdf')).toBeNull();
  });
});
