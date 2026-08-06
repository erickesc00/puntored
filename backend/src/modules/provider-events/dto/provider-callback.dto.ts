import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ProviderCallbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  providerEventId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  referenceId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  externalReference!: string;

  @IsString()
  @IsIn(['PAID'])
  status!: 'PAID';

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
