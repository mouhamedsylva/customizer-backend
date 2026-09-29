import { BadRequestException } from '@nestjs/common';

/**
 * Filtres de fichiers envoyés, PAR ROUTE.
 *
 * Un filtre unique posé sur le module (images seulement) s'appliquait à toutes
 * les routes : /uploads/piece-jointe refusait le PDF, et quote-attachment le
 * PDF, le DOCX, le XLSX et le TXT qu'elles annoncent pourtant accepter.
 */

/** Types MIME acceptés, par usage. */
export const TYPES_IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

export const TYPES_PIECE_JOINTE = [...TYPES_IMAGES, 'application/pdf'];

export const TYPES_DOCUMENTS_DEVIS = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];

/** `fileFilter` multer : rejette tôt (avant lecture complète) un type non listé. */
export function filtreTypes(types: readonly string[]) {
  return (_req: unknown, file: { mimetype?: string }, cb: (e: Error | null, ok: boolean) => void) => {
    const type = String(file.mimetype || '').toLowerCase();
    if (types.includes(type)) cb(null, true);
    else cb(new BadRequestException(`Type de fichier non accepté (${type || 'inconnu'}).`), false);
  };
}

const commence = (b: Buffer, octets: number[], decalage = 0) =>
  b.length >= decalage + octets.length && octets.every((o, i) => b[decalage + i] === o);

/**
 * Le CONTENU correspond-il au type déclaré ?
 *
 * Le type MIME vient du navigateur, donc du client : sans ce contrôle, un
 * exécutable renommé « logo.png » et déclaré image/png passait. On lit la
 * signature (les premiers octets) de chaque format.
 */
export function contenuConforme(buffer: Buffer, mimetype: string): boolean {
  const b = buffer;
  switch (String(mimetype || '').toLowerCase()) {
    case 'image/png':
      return commence(b, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/jpeg':
      return commence(b, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return commence(b, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      return commence(b, [0x52, 0x49, 0x46, 0x46]) && commence(b, [0x57, 0x45, 0x42, 0x50], 8);
    case 'application/pdf':
      return commence(b, [0x25, 0x50, 0x44, 0x46]);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return commence(b, [0x50, 0x4b, 0x03, 0x04]); // archive zip (Office récent)
    case 'application/msword':
    case 'application/vnd.ms-excel':
      return commence(b, [0xd0, 0xcf, 0x11, 0xe0]); // conteneur OLE (Office ancien)
    case 'image/svg+xml': {
      const debut = b.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
      return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(debut);
    }
    case 'text/plain':
      return !b.subarray(0, 8192).includes(0); // un octet nul trahit un binaire
    default:
      return false;
  }
}
