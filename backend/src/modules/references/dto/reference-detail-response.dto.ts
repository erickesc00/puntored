import { ApiProperty } from '@nestjs/swagger';
import { AuditActorType } from '@prisma/client';
import { ReferenceResponseDto } from './reference-response.dto';

export class ReferenceHistoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: AuditActorType })
  actorType!: AuditActorType;

  @ApiProperty({ type: String, nullable: true })
  actorId!: string | null;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  result!: string;

  @ApiProperty({ type: String, nullable: true })
  correlationId!: string | null;

  @ApiProperty({ nullable: true, type: Object, additionalProperties: true })
  metadata!: unknown;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ReferenceDetailResponseDto {
  @ApiProperty({ type: ReferenceResponseDto })
  reference!: ReferenceResponseDto;

  @ApiProperty({ type: ReferenceHistoryResponseDto, isArray: true })
  history!: ReferenceHistoryResponseDto[];
}
