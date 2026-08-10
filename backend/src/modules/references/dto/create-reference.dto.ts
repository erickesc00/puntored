import { Type } from 'class-transformer';
import {
  IsDefined,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../../../shared/vocabulary/supported-currencies';

export class CreateReferenceDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  concept!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount!: number;

  @ApiProperty({
    enum: SUPPORTED_CURRENCIES,
    enumName: 'SupportedCurrency',
    example: 'MXN',
  })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @IsIn(SUPPORTED_CURRENCIES)
  currency!: SupportedCurrency;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  dueDate!: string;
}
