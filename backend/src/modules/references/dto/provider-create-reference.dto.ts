import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CreateReferenceDto } from './create-reference.dto';

export class ProviderCreateReferenceDto extends CreateReferenceDto {
  @ApiProperty({ maxLength: 30 })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  externalReference!: string;
}
