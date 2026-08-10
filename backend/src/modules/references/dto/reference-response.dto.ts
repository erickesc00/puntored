import { ApiProperty } from '@nestjs/swagger';
import { ReferenceStatus, UserRole } from '@prisma/client';

export class ReferenceCreatorResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ required: false })
  username?: string;

  @ApiProperty({ enum: UserRole, required: false })
  role?: UserRole;
}

export class ReferenceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  externalReference!: string | null;

  @ApiProperty()
  concept!: string;

  @ApiProperty({ type: Number })
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ format: 'date-time' })
  dueDate!: string;

  @ApiProperty({ enum: ReferenceStatus })
  status!: ReferenceStatus;

  @ApiProperty()
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: ReferenceCreatorResponseDto })
  createdBy!: ReferenceCreatorResponseDto;
}
