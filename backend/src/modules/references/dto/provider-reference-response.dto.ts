import { ApiProperty } from '@nestjs/swagger';
import { ReferenceCreatorActorType, ReferenceStatus } from '@prisma/client';

export class ProviderReferenceResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  externalReference!: string;

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

  @ApiProperty({ enum: ReferenceCreatorActorType })
  creatorActorType!: ReferenceCreatorActorType;

  @ApiProperty()
  creatorActorId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
