import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ pattern: '^[A-Za-z]{3}$', example: 'COP' })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  dueDate!: string;
}
