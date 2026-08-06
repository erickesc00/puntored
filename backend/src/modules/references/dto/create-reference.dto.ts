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

export class CreateReferenceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  concept!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount!: number;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @IsDateString()
  dueDate!: string;
}
