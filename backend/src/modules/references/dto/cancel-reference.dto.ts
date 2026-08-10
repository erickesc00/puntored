import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelReferenceDto {
  @ApiProperty({ minimum: 1, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
