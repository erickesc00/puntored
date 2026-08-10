import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProviderCallbackDto {
  @ApiProperty({ maxLength: 191 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  providerEventId!: string;

  @ApiProperty({ maxLength: 191 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  referenceId!: string;

  @ApiProperty({ maxLength: 30 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  externalReference!: string;

  @ApiProperty({ enum: ['PAID', 'CANCELLED'] })
  @IsString()
  @IsIn(['PAID', 'CANCELLED'])
  status!: 'PAID' | 'CANCELLED';

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
