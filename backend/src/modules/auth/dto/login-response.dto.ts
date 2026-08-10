import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class LoginUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;
}

export class LoginSessionResponseDto {
  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  absoluteExpiresAt!: string;
}

export class LoginResponseDto {
  @ApiProperty({ type: LoginUserResponseDto })
  user!: LoginUserResponseDto;

  @ApiProperty({ type: LoginSessionResponseDto })
  session!: LoginSessionResponseDto;
}
