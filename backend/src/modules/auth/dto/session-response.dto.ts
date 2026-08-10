import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class SessionResponseUserDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty()
  sessionId!: string;
}

export class SessionResponseDto {
  @ApiProperty({ type: SessionResponseUserDto })
  user!: SessionResponseUserDto;
}
