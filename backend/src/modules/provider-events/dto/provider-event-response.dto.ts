import { ApiProperty } from '@nestjs/swagger';
import { ReferenceResponseDto } from '../../references/dto/reference-response.dto';

export class ProviderEventResponseDto {
  @ApiProperty()
  providerEventId!: string;

  @ApiProperty()
  outcome!: string;

  @ApiProperty()
  duplicate!: boolean;

  @ApiProperty({ type: ReferenceResponseDto })
  reference!: ReferenceResponseDto;
}
