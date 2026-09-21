import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';

describe('Quote Attachments (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    dataSource = moduleFixture.get<DataSource>(DataSource);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('/api/uploads/quote-attachment (POST)', () => {
    it('should upload a file successfully', async () => {
      const testFile = Buffer.from('test file content');
      
      const response = await request(app.getHttpServer())
        .post('/api/uploads/quote-attachment')
        .attach('file', testFile, 'test.txt')
        .expect(201);

      expect(response.body).toHaveProperty('url');
      expect(response.body).toHaveProperty('name', 'test.txt');
      expect(response.body).toHaveProperty('type', 'text/plain');
    });

    it('should reject unauthorized access', async () => {
      const testFile = Buffer.from('test file content');
      
      await request(app.getHttpServer())
        .post('/api/uploads/quote-attachment')
        .attach('file', testFile, 'test.txt')
        .expect(401);
    });

    it('should reject unsupported file types', async () => {
      const testFile = Buffer.from('test file content');
      
      // Mock authentication
      const response = await request(app.getHttpServer())
        .post('/api/uploads/quote-attachment')
        .set('Cookie', 'admin-session=valid-token')
        .attach('file', testFile, 'test.exe')
        .expect(400);

      expect(response.body.message).toContain('Type de fichier non accepté');
    });

    it('should reject files too large', async () => {
      const largeFile = Buffer.alloc(11 * 1024 * 1024); // 11 MB
      
      const response = await request(app.getHttpServer())
        .post('/api/uploads/quote-attachment')
        .set('Cookie', 'admin-session=valid-token')
        .attach('file', largeFile, 'large.txt')
        .expect(400);

      expect(response.body.message).toContain('trop volumineux');
    });
  });

  describe('/api/admin/quotes/:id/invoice (POST)', () => {
    it('should send invoice with attachments', async () => {
      // Create a test quote first
      const quote = await dataSource
        .getRepository('Quote')
        .save({
          id: 'test-quote-123',
          quoteData: {
            customer: { email: 'test@example.com', nom: 'Test User' },
            coin: { name: 'Test Product', qty: 1 }
          },
          draftOrderId: '123456789',
          draftStatus: 'open'
        });

      const attachments = [
        {
          name: 'document.pdf',
          url: 'https://res.cloudinary.com/test/test.pdf',
          type: 'application/pdf',
          size: '1024'
        }
      ];

      const response = await request(app.getHttpServer())
        .post(`/api/admin/quotes/${quote.id}/invoice`)
        .set('Cookie', 'admin-session=valid-token')
        .send({
          unitPrice: 29.99,
          message: 'Test invoice message',
          attachments
        })
        .expect(200);

      expect(response.body.ok).toBe(true);
    });
  });
});