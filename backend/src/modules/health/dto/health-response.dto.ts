import { ApiProperty } from '@nestjs/swagger';

export class HealthChecksResponseDto {
  @ApiProperty({ enum: ['up', 'down'] })
  database!: 'up' | 'down';
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'] })
  status!: 'ok' | 'degraded';

  @ApiProperty()
  version!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ type: HealthChecksResponseDto })
  checks!: HealthChecksResponseDto;
}
