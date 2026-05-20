import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsProcessor } from './documents.processor';
import { UploadedDocument, UploadedDocumentSchema } from '../../schemas/uploaded-document.schema';
import { DOCUMENTS_QUEUE } from './documents.constants';

export { DOCUMENTS_QUEUE } from './documents.constants';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UploadedDocument.name, schema: UploadedDocumentSchema },
    ]),
    BullModule.registerQueue({ name: DOCUMENTS_QUEUE }),
    MulterModule.register({
      storage: diskStorage({
        destination: process.env.UPLOAD_DIR || './uploads',
        filename: (_, file, cb) => {
          const ext = extname(file.originalname);
          cb(null, `${uuidv4()}${ext}`);
        },
      }),
      limits: {
        fileSize: parseInt(process.env.UPLOAD_MAX_SIZE_MB || '50', 10) * 1024 * 1024,
      },
      fileFilter: (_, file, cb) => {
        const allowed = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.txt'];
        const ext = extname(file.originalname).toLowerCase();
        cb(null, allowed.includes(ext));
      },
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsProcessor],
  exports: [DocumentsService],
})
export class DocumentsModule {}
