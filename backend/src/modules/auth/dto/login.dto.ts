import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ minLength: 3, maxLength: 100 })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username!: string;

  @ApiProperty({ minLength: 8, maxLength: 128, format: 'password' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
