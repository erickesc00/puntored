import { ApiProperty } from '@nestjs/swagger';
import { ReferenceResponseDto } from './reference-response.dto';

export class ReferencePageInfoDto {
  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class ListReferencesResponseDto {
  @ApiProperty({ type: ReferenceResponseDto, isArray: true })
  items!: ReferenceResponseDto[];

  @ApiProperty({ type: ReferencePageInfoDto })
  pageInfo!: ReferencePageInfoDto;
}
